"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  fetchCalendarAggregate,
  fetchDayAggregate,
} from "@/client/tracker-api";
import { isLocalDate } from "@/domain/calendar";
import { localDateInTimeZone } from "@/domain/planning-time";
import type { DayAggregate } from "@/domain/api-contracts";
import type { ExternalRecordAssociation } from "@/domain/external-training";
import { useQueryClient } from "@tanstack/react-query";

import { CalendarShell } from "./calendar-shell";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";

export function CalendarClient({ initialDate }: { initialDate?: string }) {
  const queryClient = useQueryClient();
  const today = localDateInTimeZone(new Date(), planningTimeZone);
  const startingDate = isLocalDate(initialDate) ? initialDate : today;
  const [selectedDate, setSelectedDate] = useState(startingDate);
  const [month, setMonth] = useState(startingDate.slice(0, 7));
  const monthQuery = useQuery({
    queryKey: trackerQueryKeys.calendar(trackerKey, month),
    queryFn: ({ signal }) => fetchCalendarAggregate(trackerKey, month, signal),
    staleTime: 5 * 60_000,
  });
  const dayQuery = useQuery({
    queryKey: trackerQueryKeys.day(trackerKey, selectedDate),
    queryFn: ({ signal }) =>
      fetchDayAggregate(trackerKey, selectedDate, signal),
    staleTime: 60_000,
  });

  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setMonth(date.slice(0, 7));
    window.history.replaceState(null, "", `/calendar?date=${date}`);
  }, []);

  const selectMonth = useCallback((nextMonth: string) => {
    const date = `${nextMonth}-01`;
    setMonth(nextMonth);
    setSelectedDate(date);
    window.history.replaceState(null, "", `/calendar?date=${date}`);
  }, []);

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
      days={monthQuery.data?.days ?? []}
      dashboard={dayQuery.data?.day ?? null}
      detailLoading={dayQuery.isPending}
      detailError={dayQuery.isError}
      onSelectDate={selectDate}
      onSelectMonth={selectMonth}
      onExternalTrainingUpdated={updateAssociation}
    />
  );
}
