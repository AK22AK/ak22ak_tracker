"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  fetchCalendarAggregate,
  fetchDayAggregate,
} from "@/client/tracker-api";
import { isLocalDate, monthBounds } from "@/domain/calendar";
import { localDateInTimeZone } from "@/domain/planning-time";
import type { DayAggregate } from "@/domain/api-contracts";
import type { ExternalRecordAssociation } from "@/domain/external-training";
import { useQueryClient } from "@tanstack/react-query";

import { CalendarShell } from "./calendar-shell";
import type {
  OfflineCalendarSnapshot,
  OfflineDaySnapshot,
} from "@/offline/snapshot-contracts";
import { useQuerySnapshot } from "@/offline/use-query-snapshot";
import { useEffect } from "react";
import { useOfflineCommands } from "@/offline/offline-command-context";
import {
  projectCalendarPendingCommands,
  projectDayPendingCommands,
} from "@/offline/command-projection";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";

export function CalendarClient({ initialDate }: { initialDate?: string }) {
  const queryClient = useQueryClient();
  const { commands } = useOfflineCommands();
  const today = localDateInTimeZone(new Date(), planningTimeZone);
  const startingDate = isLocalDate(initialDate) ? initialDate : today;
  const [selectedDate, setSelectedDate] = useState(startingDate);
  const [month, setMonth] = useState(startingDate.slice(0, 7));
  const monthQuery = useQuery({
    queryKey: trackerQueryKeys.calendar(trackerKey, month),
    queryFn: ({ signal }) => fetchCalendarAggregate(trackerKey, month, signal),
    staleTime: 5 * 60_000,
  });
  const {
    data: monthSnapshotData,
    isPending: monthSnapshotPending,
    persist: persistMonthSnapshot,
  } = useQuerySnapshot<OfflineCalendarSnapshot>({
    trackerKey,
    kind: "calendar-month",
    scope: month,
  });
  const dayQuery = useQuery({
    queryKey: trackerQueryKeys.day(trackerKey, selectedDate),
    queryFn: ({ signal }) =>
      fetchDayAggregate(trackerKey, selectedDate, signal),
    staleTime: 60_000,
  });
  const {
    data: daySnapshotData,
    isPending: daySnapshotPending,
    persist: persistDaySnapshot,
  } = useQuerySnapshot<OfflineDaySnapshot>({
    trackerKey,
    kind: "day",
    scope: selectedDate,
  });

  useEffect(() => {
    if (!monthQuery.data) return;
    void persistMonthSnapshot(
      monthQuery.data,
      `month:${monthQuery.data.month}`,
      monthQuery.dataUpdatedAt,
    );
  }, [monthQuery.data, monthQuery.dataUpdatedAt, persistMonthSnapshot]);

  useEffect(() => {
    if (!dayQuery.data) return;
    void persistDaySnapshot(
      dayQuery.data,
      `plan:${dayQuery.data.plan?.version ?? "none"}`,
      dayQuery.dataUpdatedAt,
    );
  }, [dayQuery.data, dayQuery.dataUpdatedAt, persistDaySnapshot]);

  const monthBase = monthQuery.data ?? monthSnapshotData?.data;
  const dayBase = dayQuery.data ?? daySnapshotData?.data;
  const monthData = monthBase
    ? projectCalendarPendingCommands(monthBase, commands)
    : null;
  const dayData = dayBase
    ? projectDayPendingCommands(dayBase, commands).data
    : null;
  const readOnlyOffline =
    (!monthQuery.data && !!monthSnapshotData) ||
    (!dayQuery.data && !!daySnapshotData);

  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setMonth(date.slice(0, 7));
    window.history.replaceState(null, "", `/calendar?date=${date}`);
  }, []);

  const selectMonth = useCallback(
    (nextMonth: string) => {
      const desiredDay = Number(selectedDate.slice(-2));
      const lastDay = Number(monthBounds(nextMonth).end.slice(-2));
      const date = `${nextMonth}-${String(Math.min(desiredDay, lastDay)).padStart(2, "0")}`;
      setMonth(nextMonth);
      setSelectedDate(date);
      window.history.replaceState(null, "", `/calendar?date=${date}`);
    },
    [selectedDate],
  );

  const updateAssociation = useCallback(
    (recordId: string, association: ExternalRecordAssociation) => {
      queryClient.setQueryData<DayAggregate>(
        trackerQueryKeys.day(trackerKey, selectedDate),
        (current) =>
          current
            ? {
                ...current,
                day: {
                  ...current.day,
                  externalTrainingRecords:
                    current.day.externalTrainingRecords.map((record) =>
                      record.id === recordId
                        ? { ...record, association, suggestion: null }
                        : record,
                    ),
                },
              }
            : current,
      );
    },
    [queryClient, selectedDate],
  );

  return (
    <CalendarShell
      month={month}
      today={today}
      selectedDate={selectedDate}
      days={monthData?.days ?? []}
      monthLoading={
        !monthData &&
        (monthSnapshotPending ||
          (monthQuery.isPending && monthQuery.fetchStatus !== "paused"))
      }
      monthError={
        !monthData &&
        !monthSnapshotPending &&
        (monthQuery.isError || monthQuery.fetchStatus === "paused")
      }
      dashboard={dayData?.day ?? null}
      detailLoading={
        !dayData &&
        (daySnapshotPending ||
          (dayQuery.isPending && dayQuery.fetchStatus !== "paused"))
      }
      detailError={
        !dayData &&
        !daySnapshotPending &&
        (dayQuery.isError || dayQuery.fetchStatus === "paused")
      }
      readOnlyOffline={readOnlyOffline}
      offlineSavedAt={
        readOnlyOffline
          ? (daySnapshotData?.savedAt ?? monthSnapshotData?.savedAt ?? null)
          : null
      }
      onRetryDetail={() => void dayQuery.refetch()}
      onRetryMonth={() => void monthQuery.refetch()}
      onSelectDate={selectDate}
      onSelectMonth={selectMonth}
      onExternalTrainingUpdated={updateAssociation}
    />
  );
}
