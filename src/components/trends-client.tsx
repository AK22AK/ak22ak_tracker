"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTrendsAggregate } from "@/client/tracker-api";
import type { TrendsAggregate } from "@/domain/trends";

const trackerKey = "knee-rehab";

function weekLabel(week: TrendsAggregate["weeks"][number]) {
  if (week.isCurrentWeek) return "本周";
  const start = Number(week.weekStart.slice(5, 7));
  const day = Number(week.weekStart.slice(8, 10));
  return `${start}月${day}日当周`;
}

function percentage(rate: number | null) {
  return rate === null ? null : Math.round(rate * 100);
}

function CompletionTrend({ data }: { data: TrendsAggregate }) {
  return (
    <section
      className="surface-card trend-card"
      aria-labelledby="task-trend-title"
    >
      <header className="trend-section-heading">
        <div>
          <p className="eyebrow">最近 8 周</p>
          <h2 id="task-trend-title">任务完成</h2>
        </div>
      </header>
      <div className="trend-list">
        {data.weeks.map((week) => {
          const rate = percentage(week.tasks.completionRate);
          const ariaLabel =
            rate === null
              ? `${weekLabel(week)}没有训练任务`
              : `${weekLabel(week)}任务完成率 ${rate}%，完成 ${week.tasks.completed} 项，共 ${week.tasks.total} 项`;
          return (
            <div
              className="trend-row"
              key={week.weekStart}
              role="img"
              aria-label={ariaLabel}
            >
              <div className="trend-row-heading">
                <strong>{weekLabel(week)}</strong>
                <span>{rate === null ? "暂无任务" : `${rate}%`}</span>
              </div>
              <div className="trend-bar" aria-hidden="true">
                <span
                  className="trend-bar-fill"
                  style={{ width: `${rate ?? 0}%` }}
                />
              </div>
              <p>
                完成 {week.tasks.completed} · 待完成 {week.tasks.planned} · 跳过{" "}
                {week.tasks.skipped}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SymptomTrend({ data }: { data: TrendsAggregate }) {
  return (
    <section
      className="surface-card trend-card"
      aria-labelledby="symptom-trend-title"
    >
      <header className="trend-section-heading">
        <div>
          <p className="eyebrow">疼痛与反馈</p>
          <h2 id="symptom-trend-title">每周最高疼痛</h2>
        </div>
      </header>
      <p className="trend-guidance">未反馈的日期不会按 0 分计算。</p>
      <div className="trend-list">
        {data.weeks.map((week) => {
          const pain = week.symptoms.maxPain;
          const coverage =
            week.symptoms.expectedDays === 0
              ? 0
              : Math.round(
                  (week.symptoms.feedbackDays / week.symptoms.expectedDays) *
                    100,
                );
          const ariaLabel =
            pain === null
              ? `${weekLabel(week)}没有身体反馈，反馈 ${week.symptoms.feedbackDays} 天，共需反馈 ${week.symptoms.expectedDays} 天`
              : `${weekLabel(week)}最高疼痛 ${pain} 分，反馈 ${week.symptoms.feedbackDays} 天，共需反馈 ${week.symptoms.expectedDays} 天`;
          return (
            <div
              className="trend-row trend-symptom-row"
              key={week.weekStart}
              role="img"
              aria-label={ariaLabel}
            >
              <div className="trend-row-heading">
                <strong>{weekLabel(week)}</strong>
                <span>{pain === null ? "无反馈" : `${pain} / 10`}</span>
              </div>
              <div className="trend-bar" aria-hidden="true">
                <span
                  className="trend-bar-fill trend-bar-fill-symptom"
                  style={{ width: `${pain === null ? 0 : pain * 10}%` }}
                />
              </div>
              <p>
                反馈 {week.symptoms.feedbackDays} / {week.symptoms.expectedDays}{" "}
                天 · 覆盖 {coverage}%
              </p>
              <p className="trend-safety-counts">
                绿灯 {week.symptoms.safetyDays.green} · 黄灯{" "}
                {week.symptoms.safetyDays.yellow} · 红灯{" "}
                {week.symptoms.safetyDays.red}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatDuration(value: number | null) {
  return value === null ? "未测量" : `${Math.round(value)} 分钟`;
}

function formatDistance(value: number | null) {
  return value === null ? "未测量" : `${value.toFixed(1)} 公里`;
}

function TrainingLoadTrend({ data }: { data: TrendsAggregate }) {
  return (
    <section
      className="surface-card trend-card"
      aria-labelledby="training-load-title"
    >
      <header className="trend-section-heading">
        <div>
          <p className="eyebrow">训练记录覆盖</p>
          <h2 id="training-load-title">每周训练</h2>
        </div>
      </header>
      <p className="trend-guidance">
        时长和距离只统计已有记录的完成任务；未测量不会按 0 计算。
      </p>
      <div className="trend-list">
        {data.weeks.map((week) => {
          const load = week.load;
          const source = load.sourceCoverage;
          const ariaLabel = `${weekLabel(week)}完成训练 ${load.completedTasks} 项，共 ${load.completedTrainingDays} 天；时长 ${formatDuration(load.measuredDurationMinutes)}，覆盖 ${load.durationCoveredTasks} 项；距离 ${formatDistance(load.measuredDistanceKm)}，覆盖 ${load.distanceCoveredTasks} 项`;
          return (
            <div
              className="trend-row trend-load-row"
              key={week.weekStart}
              role="img"
              aria-label={ariaLabel}
            >
              <div className="trend-row-heading">
                <strong>{weekLabel(week)}</strong>
                <span>{load.completedTrainingDays} 天</span>
              </div>
              <div className="trend-load-metrics" aria-hidden="true">
                <p>
                  <strong>
                    {formatDuration(load.measuredDurationMinutes)}
                  </strong>
                  <span>
                    时长覆盖 {load.durationCoveredTasks} / {load.completedTasks}{" "}
                    项
                  </span>
                </p>
                <p>
                  <strong>{formatDistance(load.measuredDistanceKm)}</strong>
                  <span>距离覆盖 {load.distanceCoveredTasks} 项</span>
                </p>
              </div>
              <p>
                手工 {source.manual} · Garmin {source.garmin} · 训记{" "}
                {source.xunji}
                {source.fallbackUnmeasured > 0
                  ? ` · 未测量 ${source.fallbackUnmeasured}`
                  : ""}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TrendsClient() {
  const query = useQuery({
    queryKey: trackerQueryKeys.trends(trackerKey),
    queryFn: ({ signal }) => fetchTrendsAggregate(trackerKey, signal),
    staleTime: 5 * 60_000,
  });

  if (!query.data && query.isPending) {
    return (
      <main
        className="app-shell page-frame trends-page"
        aria-label="趋势页面"
        aria-busy="true"
      >
        <header className="trend-page-header">
          <div>
            <p className="eyebrow">最近 8 周</p>
            <h1>趋势</h1>
          </div>
        </header>
        <section className="surface-card page-section-loading" role="status">
          正在整理最近记录…
        </section>
      </main>
    );
  }

  if (!query.data) {
    return (
      <main className="app-shell page-frame trends-page" aria-label="趋势页面">
        <header className="trend-page-header">
          <div>
            <p className="eyebrow">最近 8 周</p>
            <h1>趋势</h1>
          </div>
        </header>
        <section className="surface-card trend-error-card" role="alert">
          <h2>趋势暂时无法加载</h2>
          <p>请检查网络后再试，已有的训练和反馈记录不会受影响。</p>
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

  const currentWeek =
    query.data.weeks.find((week) => week.isCurrentWeek) ??
    query.data.weeks.at(-1)!;
  const allEmpty = query.data.weeks.every(
    (week) => week.tasks.total === 0 && week.symptoms.feedbackDays === 0,
  );

  return (
    <main className="app-shell page-frame trends-page" aria-label="趋势页面">
      <header className="trend-page-header">
        <div>
          <p className="eyebrow">最近 8 周</p>
          <h1>趋势</h1>
        </div>
        <button
          className="refresh-button trend-refresh-button"
          type="button"
          aria-label="刷新趋势"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "更新中" : "刷新"}
        </button>
      </header>

      {query.isError ? (
        <p className="inline-notice" role="status">
          暂时无法更新，继续显示上次内容。
        </p>
      ) : null}

      <section
        className="surface-card trend-current-card"
        aria-labelledby="current-week-title"
      >
        <div>
          <p className="eyebrow">本周仍在进行中</p>
          <h2 id="current-week-title">本周完成</h2>
        </div>
        <div className="trend-current-summary">
          <strong>
            {currentWeek.tasks.total === 0
              ? "暂无任务"
              : `${currentWeek.tasks.completed} / ${currentWeek.tasks.total}`}
          </strong>
          {currentWeek.tasks.completionRate === null ? null : (
            <span>{percentage(currentWeek.tasks.completionRate)}%</span>
          )}
        </div>
        <p>
          待完成 {currentWeek.tasks.planned} 项 · 跳过{" "}
          {currentWeek.tasks.skipped} 项
        </p>
        <p>
          反馈 {currentWeek.symptoms.feedbackDays} /{" "}
          {currentWeek.symptoms.expectedDays} 天
        </p>
      </section>

      <section className="surface-card trend-advice-card">
        <div>
          <p className="eyebrow">训练安排</p>
          <h2>需要调整下一步吗？</h2>
          <p>可以结合近期训练和身体反馈，生成一份只读建议。</p>
        </div>
        <Link className="primary-button" href="/trends/advice">
          查看调整建议
        </Link>
      </section>

      {allEmpty ? (
        <section className="surface-card trend-empty-card">
          <h2>记录还不够</h2>
          <p>继续记录任务和身体反馈，趋势会随着记录逐步出现。</p>
        </section>
      ) : null}

      <CompletionTrend data={query.data} />
      <TrainingLoadTrend data={query.data} />
      <p className="trend-context-note">
        训练与身体反馈按同期展示，仅供回顾记录，不表示两者存在因果关系。
      </p>
      <SymptomTrend data={query.data} />
    </main>
  );
}
