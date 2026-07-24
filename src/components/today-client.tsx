"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  fetchGitHubMirrorStatus,
  fetchIntegrationStatus,
} from "@/client/integration-api";
import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  fetchCalendarAggregate,
  fetchDayAggregate,
  fetchTodayAggregate,
} from "@/client/tracker-api";
import type { TodayAggregate } from "@/domain/api-contracts";
import type { ExternalRecordAssociation } from "@/domain/external-training";
import { localDateInTimeZone } from "@/domain/planning-time";
import type { DashboardTask } from "@/server/dashboard";
import {
  projectTodaySnapshot,
  type OfflineTodaySnapshot,
} from "@/offline/snapshot-contracts";
import { useQuerySnapshot } from "@/offline/use-query-snapshot";
import { useOfflineCommands } from "@/offline/offline-command-context";
import { projectTodayPendingCommands } from "@/offline/command-projection";
import { saveSafetyPolicy } from "@/offline/safety-policies";
import { offlineDatabase } from "@/offline/store";
import { usePrivateOfflineIdentity } from "@/offline/private-offline-context";

import { DashboardShell } from "./dashboard-shell";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";

function scheduleIdlePrefetch(callback: () => void) {
  const idleWindow = window as unknown as {
    requestIdleCallback?: (
      callback: () => void,
      options: { timeout: number },
    ) => number;
    cancelIdleCallback?: (requestId: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const requestId = idleWindow.requestIdleCallback(callback, {
      timeout: 2_000,
    });
    return () => idleWindow.cancelIdleCallback?.(requestId);
  }
  const timeoutId = globalThis.setTimeout(callback, 500);
  return () => globalThis.clearTimeout(timeoutId);
}

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
  const githubUserId = usePrivateOfflineIdentity();
  const { commands, replayNow } = useOfflineCommands();
  const localDate = localDateInTimeZone(new Date(), planningTimeZone);
  const queryKey = trackerQueryKeys.today(trackerKey, localDate);
  const prefetchedDateRef = useRef<string | null>(null);
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
    if (githubUserId) {
      const savedAt = new Date(query.dataUpdatedAt).toISOString();
      void saveSafetyPolicy(offlineDatabase, {
        githubUserId,
        trackerKey,
        policy: query.data.safetyPolicy,
        savedAt,
        expiresAt: new Date(
          query.dataUpdatedAt + 30 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      });
    }
  }, [
    githubUserId,
    persistSnapshot,
    query.data,
    query.dataUpdatedAt,
    queryClient,
  ]);

  useEffect(() => {
    if (!query.data || !navigator.onLine) return;
    if (prefetchedDateRef.current === localDate) return;
    prefetchedDateRef.current = localDate;
    return scheduleIdlePrefetch(() => {
      if (!navigator.onLine) return;
      void Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: trackerQueryKeys.calendar(
            trackerKey,
            localDate.slice(0, 7),
          ),
          queryFn: ({ signal }) =>
            fetchCalendarAggregate(trackerKey, localDate.slice(0, 7), signal),
          staleTime: 5 * 60_000,
        }),
        queryClient.prefetchQuery({
          queryKey: trackerQueryKeys.day(trackerKey, localDate),
          queryFn: ({ signal }) =>
            fetchDayAggregate(trackerKey, localDate, signal),
          staleTime: 60_000,
        }),
        queryClient.prefetchQuery({
          queryKey: integrationQueryKeys.providerStatus(trackerKey, "xunji"),
          queryFn: ({ signal }) =>
            fetchIntegrationStatus(trackerKey, "xunji", signal),
          staleTime: 5 * 60_000,
        }),
        queryClient.prefetchQuery({
          queryKey: integrationQueryKeys.githubMirrorStatus(),
          queryFn: ({ signal }) => fetchGitHubMirrorStatus(signal),
          staleTime: 60_000,
        }),
      ]);
    });
  }, [localDate, query.data, queryClient]);

  const baseAggregate = query.data ?? snapshotData?.data;
  const projected = baseAggregate
    ? projectTodayPendingCommands(baseAggregate, commands)
    : null;
  const aggregate = projected?.data ?? null;
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
            {query.isError
              ? "今日内容暂时无法加载"
              : "当前离线且本机没有可用内容"}
          </h1>
          <p>请检查网络后重试。离线时可以查看最近保存在本机的内容。</p>
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
      onRetryPending={replayNow}
      pendingSummary={projected?.pending ?? null}
      onExecutionChanged={() => query.refetch()}
      onTaskUpdated={handleTaskUpdated}
      onExternalTrainingUpdated={handleExternalTrainingUpdated}
    />
  );
}
