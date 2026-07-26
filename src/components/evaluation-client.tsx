"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import { createEvaluationSession, fetchEvaluation } from "@/client/tracker-api";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type { EvaluationSessionSnapshot } from "@/domain/evaluation";

const trackerKey = "knee-rehab";

function weekLabel(week: EvaluationSessionSnapshot["weeks"][number]) {
  return `${week.weekStart.slice(5).replace("-", "/")}–${week.weekEnd
    .slice(5)
    .replace("-", "/")}`;
}

function safetyLabel(level: "green" | "yellow" | "red" | null) {
  if (level === "red") return "红灯";
  if (level === "yellow") return "黄灯";
  if (level === "green") return "绿灯";
  return "无反馈";
}

function Evidence({ snapshot }: { snapshot: EvaluationSessionSnapshot }) {
  return (
    <section className="surface-card evaluation-evidence-card">
      <p className="eyebrow">{snapshot.evidenceRange.from} 起</p>
      <h2>训练周证据</h2>
      <p className="evaluation-guidance">
        有效训练周需要结合私人规则确认；当前只展示已经保存的事实。
      </p>
      <div className="evaluation-week-list">
        {snapshot.weeks.map((week) => (
          <article className="evaluation-week" key={week.weekStart}>
            <div className="evaluation-week-heading">
              <strong>{weekLabel(week)}</strong>
              <span>{safetyLabel(week.feedback.worstSafetyLevel)}</span>
            </div>
            <p>
              完成 {week.tasks.completed} / {week.tasks.total} 项
              {week.tasks.skipped > 0 ? ` · 跳过 ${week.tasks.skipped} 项` : ""}
            </p>
            <p>
              反馈 {week.feedback.feedbackDays} / {week.feedback.expectedDays}{" "}
              天
              {week.feedback.maxPain === null
                ? " · 暂无疼痛记录"
                : ` · 最高疼痛 ${week.feedback.maxPain} / 10`}
            </p>
            <p>
              暂停 {week.execution.pauseDays} 天 · 出差{" "}
              {week.execution.travelDays} 天
              {week.execution.equipmentLimitedDays > 0
                ? ` · 器械受限 ${week.execution.equipmentLimitedDays} 天`
                : ""}
              {week.execution.degradedDays > 0
                ? ` · 降级 ${week.execution.degradedDays} 天`
                : ""}
            </p>
            <p>
              时长覆盖 {week.loadCoverage.durationCoveredTasks} /{" "}
              {week.loadCoverage.completedTasks} 个完成任务
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function EvaluationClient() {
  const queryClient = useQueryClient();
  const queryKey = trackerQueryKeys.evaluation(trackerKey);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchEvaluation(trackerKey, signal),
    staleTime: 60_000,
  });
  const pending = useRef<PendingClientCommand | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function openEvaluation() {
    setSaving(true);
    setSaveError(false);
    pending.current = createOrReuseClientCommand(pending.current, {
      kind: "final",
    });
    try {
      const result = await createEvaluationSession(trackerKey, {
        ...pending.current.metadata,
        kind: "final",
      });
      queryClient.setQueryData(queryKey, result);
      pending.current = null;
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!query.data && query.isPending) {
    return (
      <main className="app-shell page-frame evaluation-page" aria-busy="true">
        <header className="evaluation-page-header">
          <p className="eyebrow">计划阶段</p>
          <h1>阶段评估</h1>
        </header>
        <section className="surface-card page-section-loading" role="status">
          正在整理评估条件…
        </section>
      </main>
    );
  }

  if (!query.data) {
    return (
      <main className="app-shell page-frame evaluation-page">
        <header className="evaluation-page-header">
          <p className="eyebrow">计划阶段</p>
          <h1>阶段评估</h1>
        </header>
        <section className="surface-card trend-error-card" role="alert">
          <h2>评估暂时无法加载</h2>
          <p>请检查网络后重试，已有记录不会受影响。</p>
          <button
            className="primary-button"
            onClick={() => void query.refetch()}
          >
            重试
          </button>
        </section>
      </main>
    );
  }

  const data = query.data;
  return (
    <main
      className="app-shell page-frame evaluation-page"
      aria-label="阶段评估页面"
    >
      <header className="evaluation-page-header">
        <div>
          <p className="eyebrow">计划阶段</p>
          <h1>阶段评估</h1>
        </div>
        <Link className="secondary-button" href="/trends">
          返回趋势
        </Link>
      </header>

      <section className="surface-card evaluation-status-card">
        <h2>评估尚未等于完成</h2>
        {data.state === "before_target" ? (
          <p>到达计划目标日 {data.targetDate} 后，才会开放评估。</p>
        ) : data.state === "eligible" ? (
          <>
            <p>已到达计划目标日。开启后只会冻结证据，不会自动宣布完成。</p>
            <button
              className="primary-button"
              type="button"
              disabled={saving}
              onClick={() => void openEvaluation()}
            >
              {saving ? "正在开启…" : "开启评估"}
            </button>
          </>
        ) : data.state === "expired" ? (
          <>
            <h3>这次评估已过期</h3>
            <p>近期计划已经变化，需要按当前安排重新整理证据。</p>
            {data.canOpenReplacement ? (
              <button
                className="primary-button"
                type="button"
                disabled={saving}
                onClick={() => void openEvaluation()}
              >
                {saving ? "正在开启…" : "重新开启评估"}
              </button>
            ) : (
              <p>到达新的目标日 {data.targetDate} 后可重新开启。</p>
            )}
          </>
        ) : data.state === "unavailable" ? (
          <p>当前计划还没有可用于评估的目标任务日期。</p>
        ) : (
          <p>证据已冻结，可先回顾记录；左右侧评估和下一步选择将在后续完成。</p>
        )}
        {saveError ? (
          <p className="inline-error" role="alert">
            暂时无法开启，内容没有保存，请稍后重试。
          </p>
        ) : null}
      </section>

      {(data.state === "opened" || data.state === "expired") && data.session ? (
        <Evidence snapshot={data.session} />
      ) : null}
    </main>
  );
}
