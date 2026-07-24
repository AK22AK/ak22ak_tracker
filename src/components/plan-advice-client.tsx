"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchPlanAdvice, requestPlanAdvice } from "@/client/tracker-api";
import type { AiAnalysisErrorCode } from "@/domain/ai-analysis";
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

      {job?.proposal ? (
        <section
          className={`surface-card plan-advice-result safety-${job.proposal.safetyLevel}`}
          aria-labelledby="plan-advice-result-title"
        >
          <div>
            <p className="eyebrow">
              {job.proposal.safetyLevel === "red"
                ? "停止并重新评估"
                : job.proposal.status === "expired"
                  ? "计划已经更新"
                  : "本次建议"}
            </p>
            <h2 id="plan-advice-result-title">{job.proposal.summary}</h2>
          </div>
          {job.proposal.status === "expired" ? (
            <p className="inline-notice" role="status">
              这份建议基于较早的计划，不能继续使用。请重新分析。
            </p>
          ) : job.proposal.safetyLevel === "red" ? (
            <p>先暂停相关训练；症状稳定或完成专业评估后，再决定后续安排。</p>
          ) : job.proposal.operations.length === 0 ? (
            <p>目前没有建议修改的训练安排。</p>
          ) : (
            <ol className="plan-advice-diffs">
              {job.proposal.operations.map((operation, index) => (
                <li key={`${operation.type}-${index}`}>
                  <strong>{operationLabel(operation)}</strong>
                  <span>{operation.reason}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="plan-advice-readonly-note">
            这是一份只读建议，当前不会修改你的计划。
          </p>
          {job.proposal.status === "expired" ? (
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
