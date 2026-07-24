"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  decidePlanChange,
  fetchPlanAdvice,
  requestPlanAdvice,
} from "@/client/tracker-api";
import type {
  AiAnalysisErrorCode,
  PlanChangeDecisionCommand,
} from "@/domain/ai-analysis";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type { PlanChangeOperation } from "@/domain/schemas";

const trackerKey = "knee-rehab";

function errorMessage(code: AiAnalysisErrorCode | null) {
  switch (code) {
    case "not_configured":
    case "invalid_configuration":
      return "分析功能暂时不可用，请稍后再试。";
    case "authentication":
    case "insufficient_balance":
      return "分析服务暂时无法使用，请稍后再试。";
    case "rate_limited":
      return "请求较多，请稍后重试。";
    case "timeout":
    case "provider_unavailable":
      return "分析没有完成，可以稍后重试。";
    case "empty_response":
    case "truncated_response":
    case "invalid_response":
    case "unsafe_proposal":
      return "这次没有得到可用建议，可以重新分析。";
    case "context_changed":
      return "近期记录或计划已经变化，请重新生成一份建议。";
    default:
      return "分析没有完成。";
  }
}

function operationLabel(operation: PlanChangeOperation) {
  switch (operation.type) {
    case "add_task":
      return `新增：${operation.task.title}（${operation.task.scheduledDate}）`;
    case "replace_task":
      return `调整：${operation.task.title}（${operation.task.scheduledDate}）`;
    case "remove_task":
      return `移除一项训练安排`;
    case "set_plan_note":
      return "更新计划说明";
  }
}

export function PlanAdviceClient() {
  const queryClient = useQueryClient();
  const [decisionIntent, setDecisionIntent] = useState<
    "accepted" | "rejected" | null
  >(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const pendingDecision = useRef<PendingClientCommand | null>(null);
  const query = useQuery({
    queryKey: trackerQueryKeys.planAdvice(trackerKey),
    queryFn: ({ signal }) => fetchPlanAdvice(trackerKey, signal),
    staleTime: 30_000,
    refetchOnMount: "always",
  });
  const mutation = useMutation({
    mutationFn: (commandId: string) => requestPlanAdvice(trackerKey, commandId),
    onSuccess: (data) => {
      queryClient.setQueryData(trackerQueryKeys.planAdvice(trackerKey), data);
    },
  });
  const decisionMutation = useMutation({
    mutationFn: (command: PlanChangeDecisionCommand) =>
      decidePlanChange(trackerKey, command),
    onSuccess: (result) => {
      pendingDecision.current = null;
      setDecisionIntent(null);
      setDecisionError(null);
      queryClient.setQueryData(
        trackerQueryKeys.planAdvice(trackerKey),
        result.page,
      );
      const months = new Set<string>();
      for (const localDate of result.affectedDates) {
        months.add(localDate.slice(0, 7));
        void queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.today(trackerKey, localDate),
          exact: true,
        });
        void queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.day(trackerKey, localDate),
          exact: true,
        });
      }
      for (const month of months) {
        void queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.calendar(trackerKey, month),
          exact: true,
        });
      }
      if (result.status === "accepted") {
        void queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.trends(trackerKey),
          exact: true,
        });
      }
    },
    onError: () => {
      setDecisionError("决定尚未保存，请检查网络后重试。你的选择仍然保留。");
    },
  });
  const job = query.data?.job ?? null;
  const unavailable =
    query.data?.configuration === "not_configured" ||
    query.data?.configuration === "invalid_configuration";
  const runningExpired = job?.status === "running" && job.retryable;
  const retryId =
    (job?.status === "failed" && job.retryable) || runningExpired
      ? job.id
      : null;
  const analyzing =
    mutation.isPending || (job?.status === "running" && !runningExpired);

  const start = () => {
    mutation.mutate(retryId ?? globalThis.crypto.randomUUID());
  };

  const proposal = job?.proposal ?? null;

  function chooseDecision(decision: "accepted" | "rejected") {
    setDecisionIntent(decision);
    setDecisionError(null);
  }

  function cancelDecision() {
    pendingDecision.current = null;
    setDecisionIntent(null);
    setDecisionError(null);
  }

  function confirmDecision() {
    if (!proposal || !decisionIntent || decisionMutation.isPending) return;
    const payload = { proposalId: proposal.id, decision: decisionIntent };
    const pending = createOrReuseClientCommand(
      pendingDecision.current,
      payload,
    );
    pendingDecision.current = pending;
    decisionMutation.mutate({ ...payload, ...pending.metadata });
  }

  return (
    <main
      className="app-shell page-frame plan-advice-page"
      aria-label="训练调整建议"
    >
      <header className="plan-advice-header">
        <div>
          <p className="eyebrow">基于近期记录</p>
          <h1>训练调整建议</h1>
        </div>
        <Link className="text-button" href="/trends">
          返回趋势
        </Link>
      </header>

      <section className="surface-card plan-advice-intro">
        <h2>先生成建议，再由你决定</h2>
        <p>
          会参考当前计划、最近的身体反馈和已确认训练。这里不会直接修改计划。
        </p>
        {!job || job.status === "running" ? (
          <button
            className="primary-button"
            type="button"
            disabled={analyzing || unavailable || query.isPending}
            onClick={() => start()}
          >
            {analyzing ? "正在分析…" : "分析并生成建议"}
          </button>
        ) : null}
        {unavailable ? (
          <p className="inline-notice" role="status">
            分析功能暂时不可用。
          </p>
        ) : null}
      </section>

      {query.isPending ? (
        <section className="surface-card page-section-loading" role="status">
          正在读取最近记录…
        </section>
      ) : null}

      {query.isError || mutation.isError ? (
        <section className="surface-card trend-error-card" role="alert">
          <h2>暂时无法分析</h2>
          <p>请检查网络后再试，已经保存的记录不会受影响。</p>
        </section>
      ) : null}

      {job?.status === "running" ? (
        <section className="surface-card page-section-loading" role="status">
          正在整理建议，离开页面后可以稍后回来查看。
        </section>
      ) : null}

      {job?.status === "failed" ? (
        <section className="surface-card plan-advice-failure" role="alert">
          <h2>这次分析没有完成</h2>
          <p>{errorMessage(job.errorCode)}</p>
          {!unavailable ? (
            <button
              className="secondary-button"
              type="button"
              disabled={mutation.isPending}
              onClick={start}
            >
              {job.retryable ? "重试" : "重新分析"}
            </button>
          ) : null}
        </section>
      ) : null}

      {proposal ? (
        <section
          className={`surface-card plan-advice-result safety-${proposal.safetyLevel}`}
          aria-labelledby="plan-advice-result-title"
        >
          <div>
            <p className="eyebrow">
              {proposal.safetyLevel === "red"
                ? "停止并重新评估"
                : proposal.status === "expired"
                  ? "计划已经更新"
                  : proposal.status === "accepted"
                    ? "已更新计划"
                    : proposal.status === "rejected"
                      ? "已拒绝"
                      : "本次建议"}
            </p>
            <h2 id="plan-advice-result-title">{proposal.summary}</h2>
          </div>
          {proposal.status === "accepted" && proposal.decision ? (
            <div className="plan-advice-decision-result" role="status">
              <p>计划已由你确认更新。</p>
              {proposal.decision.appliedPlanVersion ? (
                <p>
                  第 {proposal.decision.appliedPlanVersion.version} 版将从
                  {proposal.decision.appliedPlanVersion.effectiveFrom} 生效。
                </p>
              ) : null}
            </div>
          ) : proposal.status === "rejected" ? (
            <p className="inline-notice" role="status">
              这份建议已拒绝，当前计划没有改变。
            </p>
          ) : proposal.status === "expired" ? (
            <p className="inline-notice" role="status">
              这份建议基于较早的计划，不能继续使用。请重新分析。
            </p>
          ) : proposal.safetyLevel === "red" ? (
            <p>先暂停相关训练；症状稳定或完成专业评估后，再决定后续安排。</p>
          ) : proposal.operations.length === 0 ? (
            <p>目前没有建议修改的训练安排。</p>
          ) : (
            <ol className="plan-advice-diffs">
              {proposal.operations.map((operation, index) => (
                <li key={`${operation.type}-${index}`}>
                  <strong>{operationLabel(operation)}</strong>
                  <span>{operation.reason}</span>
                </li>
              ))}
            </ol>
          )}
          {proposal.status === "proposed" &&
          proposal.application.canAccept &&
          proposal.application.effectiveFrom ? (
            <p className="plan-advice-effective-date">
              接受后将从 {proposal.application.effectiveFrom}{" "}
              起更新后续安排，当天和历史记录不会改变。
            </p>
          ) : null}
          {proposal.status === "proposed" && decisionIntent ? (
            <div
              className="plan-advice-confirmation"
              role="group"
              aria-labelledby="plan-advice-confirmation-title"
            >
              <h3 id="plan-advice-confirmation-title">
                {decisionIntent === "accepted"
                  ? "确认更新后续计划？"
                  : "确认拒绝这份建议？"}
              </h3>
              <p>
                {decisionIntent === "accepted"
                  ? `确认后，应用会从 ${proposal.application.effectiveFrom ?? "下一个计划日"} 创建一份新的计划版本。`
                  : "拒绝只会记录你的决定，当前计划不会改变。"}
              </p>
              {decisionError ? (
                <p className="task-save-error" role="alert">
                  {decisionError}
                </p>
              ) : null}
              <div className="plan-advice-decision-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={decisionMutation.isPending}
                  onClick={confirmDecision}
                >
                  {decisionMutation.isPending
                    ? "正在保存…"
                    : decisionIntent === "accepted"
                      ? "确认接受并更新计划"
                      : "确认拒绝"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={decisionMutation.isPending}
                  onClick={cancelDecision}
                >
                  稍后
                </button>
              </div>
            </div>
          ) : null}
          {proposal.status === "proposed" && !decisionIntent ? (
            <div className="plan-advice-decision-actions">
              {proposal.application.canAccept ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => chooseDecision("accepted")}
                >
                  接受并更新计划
                </button>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                onClick={() => chooseDecision("rejected")}
              >
                拒绝这份建议
              </button>
            </div>
          ) : null}
          {proposal.status === "proposed" &&
          !proposal.application.canAccept &&
          proposal.application.blockedReason === "invalid_operations" ? (
            <div>
              <p className="inline-notice" role="status">
                这份建议不适合直接应用，请重新分析。
              </p>
              <button
                className="secondary-button"
                type="button"
                disabled={mutation.isPending || unavailable}
                onClick={() => mutation.mutate(globalThis.crypto.randomUUID())}
              >
                重新分析
              </button>
            </div>
          ) : null}
          {proposal.status === "expired" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={mutation.isPending || unavailable}
              onClick={() => mutation.mutate(globalThis.crypto.randomUUID())}
            >
              重新分析
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
