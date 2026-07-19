"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTodayAggregate } from "@/client/tracker-api";
import type { TodayAggregate } from "@/domain/api-contracts";
import type { ExternalRecordAssociation } from "@/domain/external-training";
import { localDateInTimeZone } from "@/domain/planning-time";
import type { DashboardTask } from "@/server/dashboard";
import {
  projectTodaySnapshot,
  type OfflineTodaySnapshot,
} from "@/offline/snapshot-contracts";
import { useQuerySnapshot } from "@/offline/use-query-snapshot";

import { DashboardShell } from "./dashboard-shell";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";

function todayLabel(localDate: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: planningTimeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  })
    .format(new Date(`${localDate}T12:00:00+08:00`))
    .replace("周", " · 周");
}

export function TodayClient() {
  const queryClient = useQueryClient();
  const localDate = localDateInTimeZone(new Date(), planningTimeZone);
  const queryKey = trackerQueryKeys.today(trackerKey, localDate);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchTodayAggregate(trackerKey, localDate, signal),
    staleTime: 60_000,
  });
  const {
    data: snapshotData,
    isPending: snapshotPending,
    persist: persistSnapshot,
  } = useQuerySnapshot<OfflineTodaySnapshot>({
    trackerKey,
    kind: "today",
    scope: localDate,
  });

  useEffect(() => {
    if (!query.data) return;
    queryClient.setQueryData(
      trackerQueryKeys.tracker(trackerKey),
      query.data.tracker,
    );
    queryClient.setQueryData(
      trackerQueryKeys.safetyPolicy(
        trackerKey,
        query.data.safetyPolicy.version,
      ),
      query.data.safetyPolicy,
    );
    void persistSnapshot(
      projectTodaySnapshot(query.data),
      `plan:${query.data.plan?.version ?? "none"};policy:${query.data.safetyPolicy.version}:${query.data.safetyPolicy.hash}`,
      query.dataUpdatedAt,
    );
  }, [persistSnapshot, query.data, query.dataUpdatedAt, queryClient]);

  const aggregate = query.data ?? snapshotData?.data;
  const readOnlyOffline =
    !query.data && snapshotData !== null && snapshotData !== undefined;

  if (
    !aggregate &&
    (snapshotPending || (query.isPending && query.fetchStatus !== "paused"))
  ) {
    return (
      <main className="app-shell page-frame today-page" aria-busy="true">
        <header className="today-header">
          <div>
            <p className="eyebrow">AK Tracker</p>
            <h1>{todayLabel(localDate)}</h1>
          </div>
        </header>
        <section className="surface-card page-section-loading" role="status">
          正在加载今日计划…
        </section>
      </main>
    );
  }

  if (!aggregate) {
    return (
      <main className="app-shell page-frame today-page">
        <section className="surface-card today-error-card" role="alert">
          <h1>
            {query.isError ? "今日数据暂时无法加载" : "当前离线且没有可用缓存"}
          </h1>
          <p>你的任务和草稿不会因此改变；联网后可以重新加载。</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => void query.refetch()}
          >
            重试
          </button>
        </section>
      </main>
    );
  }

  const refreshRelatedData = () => {
    void queryClient.invalidateQueries({
      queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.day(trackerKey, localDate),
    });
    void queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.calendar(trackerKey, localDate.slice(0, 7)),
    });
  };

  const updateDay = (
    update: (day: TodayAggregate["day"]) => TodayAggregate["day"],
  ) => {
    queryClient.setQueryData<TodayAggregate>(queryKey, (current) =>
      current
        ? {
            ...current,
            day: update(current.day),
          }
        : current,
    );
  };

  const handleTaskUpdated = (updated: DashboardTask) => {
    updateDay((day) => ({
      ...day,
      tasks: day.tasks.map((task) => (task.id === updated.id ? updated : task)),
    }));
    refreshRelatedData();
  };

  const handleExternalTrainingUpdated = (
    recordId: string,
    association: ExternalRecordAssociation,
  ) => {
    updateDay((day) => ({
      ...day,
      externalTrainingRecords: day.externalTrainingRecords.map((record) =>
        record.id === recordId
          ? { ...record, association, suggestion: null }
          : record,
      ),
    }));
  };

  return (
    <DashboardShell
      today={todayLabel(localDate)}
      localDate={localDate}
      planVersion={aggregate.plan?.version ?? null}
      initialDashboard={aggregate.day}
      execution={aggregate.execution}
      readOnlyOffline={readOnlyOffline}
      offlineSavedAt={readOnlyOffline ? (snapshotData?.savedAt ?? null) : null}
      onRefresh={() => query.refetch()}
      onExecutionChanged={() => query.refetch()}
      onTaskUpdated={handleTaskUpdated}
      onExternalTrainingUpdated={handleExternalTrainingUpdated}
    />
  );
}
