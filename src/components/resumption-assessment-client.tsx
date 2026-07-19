"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  decideResumption,
  fetchResumptionAssessment,
} from "@/client/tracker-api";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type { ResumptionDecisionCommand } from "@/domain/resumption";

import { StatusPill, SurfaceCard } from "./ui/primitives";

const trackerKey = "knee-rehab";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function triggerLabel(type: "execution_context" | "pause") {
  return type === "pause" ? "暂停" : "出差或器械受限";
}

export function ResumptionAssessmentClient({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = trackerQueryKeys.resumptionAssessment(
    trackerKey,
    assessmentId,
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchResumptionAssessment(trackerKey, assessmentId, signal),
    staleTime: 30_000,
  });
  const [decision, setDecision] = useState<"keep_original" | "shift">(
    "keep_original",
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: "kept_original" | "shifted" | "expired";
    replacementAssessmentId: string | null;
  } | null>(null);
  const pendingCommand = useRef<PendingClientCommand | null>(null);
  const [ids] = useState(() => ({
    replacementAssessmentId: crypto.randomUUID(),
    newPlanVersionId: crypto.randomUUID(),
  }));

  if (result) {
    return (
      <main className="app-shell page-frame resumption-page">
        <SurfaceCard className="resumption-result" role="status">
          <StatusPill
            tone={result.status === "expired" ? "attention" : "success"}
          >
            {result.status === "expired" ? "需要重新确认" : "已保存"}
          </StatusPill>
          <h1>
            {result.status === "kept_original"
              ? "将按原计划继续"
              : result.status === "shifted"
                ? "后续安排已顺延"
                : "基础计划已变化"}
          </h1>
          <p>
            {result.status === "expired"
              ? "旧评估没有覆盖新计划，系统已基于最新版本重新生成。"
              : "这次决定已记录，历史训练、反馈和任务状态保持不变。"}
          </p>
          <div className="resumption-actions">
            {result.replacementAssessmentId ? (
              <Link
                className="primary-button"
                href={`/resumption/${result.replacementAssessmentId}`}
              >
                查看新评估
              </Link>
            ) : null}
            <Link className="secondary-button" href="/" scroll={false}>
              返回今日
            </Link>
          </div>
        </SurfaceCard>
      </main>
    );
  }

  if (query.isPending) {
    return (
      <main className="app-shell page-frame resumption-page" aria-busy="true">
        <SurfaceCard className="page-section-loading" role="status">
          正在准备接续评估…
        </SurfaceCard>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="app-shell page-frame resumption-page">
        <SurfaceCard role="alert">
          <h1>接续评估暂时无法加载</h1>
          <p>基础计划和今天任务都没有改变，可以稍后重试。</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => void query.refetch()}
          >
            重试
          </button>
        </SurfaceCard>
      </main>
    );
  }

  const assessment = query.data;

  async function submit() {
    if (saving || assessment.status !== "pending") return;
    setSaving(true);
    setErrorMessage(null);
    const payload = {
      assessmentId: assessment.id,
      basePlanVersionId: assessment.basePlanVersion.id,
      replacementAssessmentId: ids.replacementAssessmentId,
      decision,
      ...(decision === "shift"
        ? {
            effectiveFrom: assessment.recommendedEffectiveFrom,
            newPlanVersionId: ids.newPlanVersionId,
          }
        : {}),
    };
    const pending = createOrReuseClientCommand(pendingCommand.current, payload);
    pendingCommand.current = pending;
    try {
      const command = {
        ...payload,
        ...pending.metadata,
      } as ResumptionDecisionCommand;
      const saved = await decideResumption(trackerKey, command);
      pendingCommand.current = null;
      setResult({
        status: saved.status,
        replacementAssessmentId: saved.replacementAssessmentId,
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({
        queryKey: ["today", trackerKey],
      });
      void queryClient.invalidateQueries({
        queryKey: ["calendar", trackerKey],
      });
    } catch {
      setErrorMessage("决定尚未保存，请检查网络后重试。你的选择仍然保留。");
    } finally {
      setSaving(false);
    }
  }

  if (assessment.status !== "pending") {
    return (
      <main className="app-shell page-frame resumption-page">
        <SurfaceCard>
          <StatusPill tone="success">已处理</StatusPill>
          <h1>这份接续评估已经完成</h1>
          <p>历史决定仍可审计，今天页面会按当前有效计划显示。</p>
          <Link className="primary-button" href="/" scroll={false}>
            返回今日
          </Link>
        </SurfaceCard>
      </main>
    );
  }

  return (
    <main className="app-shell page-frame resumption-page">
      <header className="topbar resumption-header">
        <div>
          <p className="eyebrow">计划接续</p>
          <h1>确认中断后怎样继续</h1>
          <p>确认前不会修改今天任务或基础计划。</p>
        </div>
        <Link className="text-button" href="/" scroll={false}>
          返回今日
        </Link>
      </header>

      <SurfaceCard className="resumption-summary-card">
        <div className="resumption-summary-heading">
          <h2>{triggerLabel(assessment.trigger.type)}摘要</h2>
          <StatusPill tone="attention">待确认</StatusPill>
        </div>
        <dl className="resumption-facts">
          <div>
            <dt>中断范围</dt>
            <dd>
              {dateLabel(assessment.trigger.startDate)} 至{" "}
              {dateLabel(assessment.trigger.endDate)}
            </dd>
          </div>
          <div>
            <dt>中断天数</dt>
            <dd>{assessment.trigger.interruptionDays} 天</dd>
          </div>
          <div>
            <dt>基础计划</dt>
            <dd>v{assessment.basePlanVersion.version}</dd>
          </div>
          <div>
            <dt>最后确认训练</dt>
            <dd>
              {assessment.lastConfirmedTraining
                ? `${assessment.lastConfirmedTraining.title} · ${dateLabel(assessment.lastConfirmedTraining.scheduledOn)}`
                : "中断前暂无已确认训练"}
            </dd>
          </div>
        </dl>
        <p className="supporting-copy">
          暂停日不会被当作普通漏练；受限期间选择的备选训练也不会自动标记基础任务完成。
        </p>
      </SurfaceCard>

      <SurfaceCard className="resumption-options-card">
        <h2>选择接续方式</h2>
        <label className="resumption-option">
          <input
            type="radio"
            name="resumption-decision"
            value="keep_original"
            checked={decision === "keep_original"}
            onChange={() => setDecision("keep_original")}
          />
          <span>
            <strong>按原计划继续</strong>
            <small>只记录决定，不创建新的计划版本。</small>
          </span>
        </label>
        <label className="resumption-option">
          <input
            type="radio"
            name="resumption-decision"
            value="shift"
            disabled={!assessment.shiftAvailability.allowed}
            checked={decision === "shift"}
            onChange={() => setDecision("shift")}
          />
          <span>
            <strong>顺延后续安排</strong>
            <small>
              只顺延生效日起尚未执行的未来任务，并创建不可变计划版本。
            </small>
          </span>
        </label>

        {!assessment.shiftAvailability.allowed ? (
          <p className="form-message attention" role="note">
            {assessment.shiftAvailability.reason ===
            "future_plan_version_exists"
              ? "已有后续计划版本，暂时不能顺延；请先处理计划时间线。你仍可选择按原计划继续。"
              : "这份较早的评估缺少完整计划时间线，不能安全顺延；你仍可选择按原计划继续。"}
          </p>
        ) : null}

        {decision === "shift" ? (
          <div className="resumption-diff" aria-label="顺延日期差异">
            <h3>确认后的日期变化</h3>
            {assessment.shiftPreview.length > 0 ? (
              <ul>
                {assessment.shiftPreview.map((item) => (
                  <li key={item.taskDefinitionId}>
                    <strong>{item.title}</strong>
                    <span>
                      {dateLabel(item.from)} → {dateLabel(item.to)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>当前没有尚未执行的未来任务需要顺延。</p>
            )}
          </div>
        ) : null}

        {errorMessage ? (
          <p className="form-message error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <button
          className="primary-button"
          type="button"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? "保存中…" : "确认接续方式"}
        </button>
      </SurfaceCard>
    </main>
  );
}
