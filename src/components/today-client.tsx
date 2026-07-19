"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTodayAggregate } from "@/client/tracker-api";
import type { TodayAggregate } from "@/domain/api-contracts";
import { localDateInTimeZone } from "@/domain/planning-time";
import type { DashboardTask } from "@/server/dashboard";

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
  }, [query.data, queryClient]);

  if (query.isPending) {
    return (
      <main className="app-shell page-frame" aria-busy="true">
        <header className="topbar">
          <div>
            <p className="eyebrow">AK Tracker</p>
            <h1>{todayLabel(localDate)}</h1>
          </div>
        </header>
        <section className="hero-card page-section-loading" role="status">
          正在加载今日计划…
        </section>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="app-shell page-frame">
        <section className="feedback-card" role="alert">
          <h1>今日数据暂时无法加载</h1>
          <button type="button" onClick={() => void query.refetch()}>
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

  const handleFeedbackSaved = () => {
    updateDay((day) => ({
      ...day,
      feedbackCount: day.feedbackCount + 1,
    }));
    refreshRelatedData();
  };

  return (
    <DashboardShell
      today={todayLabel(localDate)}
      initialDashboard={query.data.day}
      safetyPolicy={query.data.safetyPolicy}
      onRefresh={() => query.refetch()}
      onTaskUpdated={handleTaskUpdated}
      onFeedbackSaved={handleFeedbackSaved}
    />
  );
}
