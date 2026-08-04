"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTrendsAggregate } from "@/client/tracker-api";
import type { TrendsAggregate } from "@/domain/trends";

const trackerKey = "knee-rehab";

type TrendWeek = TrendsAggregate["weeks"][number];

function weekLabel(week: TrendWeek) {
  if (week.isCurrentWeek) return "本周";
  const start = Number(week.weekStart.slice(5, 7));
  const day = Number(week.weekStart.slice(8, 10));
  return `${start}月${day}日当周`;
}

function percentage(rate: number | null) {
  return rate === null ? null : Math.round(rate * 100);
}

function formatDuration(value: number | null) {
  return value === null ? null : `${Math.round(value)} 分钟`;
}

function formatDistance(value: number | null) {
  return value === null ? null : `${value.toFixed(1)} 公里`;
}

function formatSleepDuration(value: number | null) {
  if (value === null) return null;
  const minutes = Math.round(value / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} 分钟`;
  return remainder === 0 ? `${hours} 小时` : `${hours} 小时 ${remainder} 分钟`;
}

function taskSummary(week: TrendWeek) {
  const rate = percentage(week.tasks.completionRate);
  return rate === null
    ? "没有安排任务"
    : `完成 ${week.tasks.completed}/${week.tasks.total}（${rate}%）`;
}

function symptomSummary(week: TrendWeek) {
  if (week.symptoms.maxPain === null) {
    return week.symptoms.expectedDays === 0
      ? "没有身体反馈"
      : `无身体反馈（${week.symptoms.feedbackDays}/${week.symptoms.expectedDays} 天）`;
  }
  return `最高疼痛 ${week.symptoms.maxPain}/10（${week.symptoms.feedbackDays}/${week.symptoms.expectedDays} 天）`;
}

function trainingSummary(week: TrendWeek) {
  const values = [
    formatDuration(week.load.measuredDurationMinutes),
    formatDistance(week.load.measuredDistanceKm),
  ].filter((value): value is string => value !== null);
  return values.length > 0
    ? values.join(" · ")
    : week.load.completedTasks > 0
      ? `完成 ${week.load.completedTasks} 项，时长与距离未测量`
      : "没有可用训练记录";
}

function recoverySummary(week: TrendWeek) {
  const sleep = formatSleepDuration(
    week.recovery.sleep.averageTotalSleepSeconds,
  );
  const steps = week.recovery.steps.averageDailySteps;
  const values = [
    sleep ? `睡眠 ${sleep}` : null,
    steps === null ? null : `步数 ${steps.toLocaleString("zh-CN")}`,
  ].filter((value): value is string => value !== null);
  return values.length > 0 ? values.join(" · ") : "没有恢复参考记录";
}

function sourceCoverageSummary(week: TrendWeek) {
  const coverage = week.load.sourceCoverage;
  const labels = [
    coverage.manual > 0 ? `手工 ${coverage.manual} 项` : null,
    coverage.garmin > 0 ? `Garmin ${coverage.garmin} 项` : null,
    coverage.xunji > 0 ? `训记 ${coverage.xunji} 项` : null,
    coverage.fallbackUnmeasured > 0
      ? `未测量 ${coverage.fallbackUnmeasured} 项`
      : null,
  ].filter((value): value is string => value !== null);
  return labels.length > 0 ? `来源：${labels.join("；")}` : "没有训练来源覆盖";
}

function detailCoverageSummary(week: TrendWeek) {
  const safety = week.symptoms.safetyDays;
  const sleepScore =
    week.recovery.sleep.averageSleepScore === null
      ? "睡眠评分未测量"
      : `睡眠评分 ${Math.round(week.recovery.sleep.averageSleepScore)}，覆盖 ${week.recovery.sleep.scoreCoverageDays} 天`;
  return `${weekLabel(week)}：任务待完成 ${week.tasks.planned} 项、跳过 ${week.tasks.skipped} 项；反馈 ${week.symptoms.feedbackDays}/${week.symptoms.expectedDays} 天；绿灯 ${safety.green} 天；黄灯 ${safety.yellow} 天；红灯 ${safety.red} 天；时长覆盖 ${week.load.durationCoveredTasks}/${week.load.completedTasks} 项；${sourceCoverageSummary(week)}；睡眠 ${week.recovery.sleep.availableDays}/${week.recovery.sleep.expectedDays} 天；${sleepScore}；步数 ${week.recovery.steps.availableDays}/${week.recovery.steps.expectedDays} 天。`;
}

function weekAriaLabel(week: TrendWeek) {
  return `${weekLabel(week)}：${taskSummary(week)}；${symptomSummary(week)}；训练 ${trainingSummary(week)}；${recoverySummary(week)}。`;
}

function hasAnyRecord(week: TrendWeek) {
  return (
    week.tasks.total > 0 ||
    week.symptoms.feedbackDays > 0 ||
    week.load.completedTasks > 0 ||
    week.recovery.sleep.availableDays > 0 ||
    week.recovery.steps.availableDays > 0
  );
}

function TrendSeries({ data }: { data: TrendsAggregate }) {
  return (
    <section
      className="surface-card trend-series-card"
      aria-labelledby="eight-week-trend-title"
    >
      <header className="trend-section-heading">
        <div>
          <p className="eyebrow">最近 8 周</p>
          <h2 id="eight-week-trend-title">训练、反馈与恢复参考</h2>
        </div>
      </header>
      <p className="trend-guidance">
        缺失记录不会按 0 计算；睡眠、步数与训练仅作同期回顾，不表示因果关系。
      </p>
      <div className="trend-series" role="list" aria-label="最近八周趋势">
        {data.weeks.map((week) => (
          <article
            className="trend-series-row"
            key={week.weekStart}
            role="listitem"
            aria-label={weekAriaLabel(week)}
          >
            <div className="trend-row-heading">
              <strong>{weekLabel(week)}</strong>
              <span>{taskSummary(week)}</span>
            </div>
            <dl className="trend-series-metrics" aria-hidden="true">
              <div>
                <dt>疼痛</dt>
                <dd>{symptomSummary(week)}</dd>
              </div>
              <div>
                <dt>训练</dt>
                <dd>{trainingSummary(week)}</dd>
              </div>
              <div>
                <dt>恢复</dt>
                <dd>{recoverySummary(week)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <details className="trend-details">
        <summary>查看数据覆盖与说明</summary>
        <p>
          身体反馈缺失不代表疼痛为 0；未测量的时长、距离、睡眠和步数不会补成 0。
        </p>
        <ul>
          {data.weeks.map((week) => (
            <li key={week.weekStart}>{detailCoverageSummary(week)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function CurrentWeekSummary({ week }: { week: TrendWeek }) {
  const hasAttention =
    week.symptoms.safetyDays.yellow > 0 || week.symptoms.safetyDays.red > 0;
  const attentionLabel =
    week.symptoms.safetyDays.red > 0
      ? `本周有 ${week.symptoms.safetyDays.red} 天红灯，请先按安全提示处理。`
      : `本周有 ${week.symptoms.safetyDays.yellow} 天黄灯，请留意身体反馈。`;

  return (
    <>
      <section
        className="surface-card trend-current-card"
        aria-labelledby="current-week-title"
      >
        <div>
          <p className="eyebrow">本周摘要</p>
          <h2 id="current-week-title">{taskSummary(week)}</h2>
        </div>
        <div className="trend-current-summary">
          <strong>{symptomSummary(week)}</strong>
        </div>
        <p>训练：{trainingSummary(week)}</p>
        <p>恢复：{recoverySummary(week)}</p>
      </section>
      {hasAttention ? (
        <p className="trend-attention-notice" role="status">
          {attentionLabel}
        </p>
      ) : null}
    </>
  );
}

function MoreTrendActions() {
  return (
    <details className="trend-more-actions">
      <summary>更多</summary>
      <div>
        <Link href="/plan/advice">查看调整建议</Link>
        <Link href="/plan/evaluation">查看阶段评估</Link>
      </div>
    </details>
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
        aria-label="近期回顾页面"
        aria-busy="true"
      >
        <header className="trend-page-header">
          <div>
            <p className="eyebrow">最近 8 周</p>
            <h1>近期回顾</h1>
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
      <main
        className="app-shell page-frame trends-page"
        aria-label="近期回顾页面"
      >
        <header className="trend-page-header">
          <div>
            <p className="eyebrow">最近 8 周</p>
            <h1>近期回顾</h1>
          </div>
        </header>
        <section className="surface-card trend-error-card" role="alert">
          <h2>近期回顾暂时无法加载</h2>
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
  const allEmpty = query.data.weeks.every((week) => !hasAnyRecord(week));

  return (
    <main
      className="app-shell page-frame trends-page"
      aria-label="近期回顾页面"
    >
      <header className="trend-page-header">
        <div>
          <p className="eyebrow">最近 8 周</p>
          <h1>近期回顾</h1>
        </div>
        <button
          className="refresh-button trend-refresh-button"
          type="button"
          aria-label="刷新近期回顾"
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

      {allEmpty ? (
        <section className="surface-card trend-empty-card trend-empty-action">
          <h2>还没有可回顾的趋势</h2>
          <p>完成今天的任务或记录一次身体反馈后，这里会逐步形成趋势。</p>
          <Link className="primary-button" href="/">
            回到今天
          </Link>
        </section>
      ) : (
        <>
          <CurrentWeekSummary week={currentWeek} />
          <TrendSeries data={query.data} />
          <MoreTrendActions />
        </>
      )}
    </main>
  );
}
