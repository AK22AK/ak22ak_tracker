"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTodayAggregate } from "@/client/tracker-api";
import { localDateInTimeZone } from "@/domain/planning-time";

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
  const query = useQuery({
    queryKey: trackerQueryKeys.today(trackerKey, localDate),
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
      queryKey: trackerQueryKeys.today(trackerKey, localDate),
    });
    void queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.day(trackerKey, localDate),
    });
    void queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.calendar(trackerKey, localDate.slice(0, 7)),
    });
  };

  return (
    <DashboardShell
      key={query.dataUpdatedAt}
      today={todayLabel(localDate)}
      initialDashboard={query.data.day}
      safetyPolicy={query.data.safetyPolicy}
      onRefresh={() => query.refetch()}
      onDataChanged={refreshRelatedData}
    />
  );
}
