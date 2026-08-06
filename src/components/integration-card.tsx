"use client";

import { useContext, useEffect, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";

import { integrationQueryKeys } from "@/client/query-keys";
import {
  integrationCatchUpResultSchema,
  integrationStatusSchema,
  type IntegrationStatus,
} from "@/domain/integrations";

export type IntegrationCardDefinition = {
  provider: string;
  displayName: string;
  description: string;
};

function syncFailureMessage(
  displayName: string,
  errorCode: string,
  retryAfterMs?: number | null,
) {
  if (errorCode === "authentication") {
    return `${displayName}连接已失效，请更新 API Key 后重试。`;
  }
  if (errorCode === "rate_limited") {
    if (retryAfterMs && retryAfterMs > 0) {
      return `${displayName}请求过于频繁，请约 ${Math.ceil(retryAfterMs / 1_000)} 秒后重试。`;
    }
    return `${displayName}请求过于频繁，请稍后重试。`;
  }
  if (errorCode === "sync_in_progress") {
    return `另一项${displayName}同步正在进行，请稍后继续。`;
  }
  if (errorCode === "membership_required") {
    return `${displayName}仅支持 VIP 会员使用，请升级会员后重试。`;
  }
  if (errorCode === "invalid_response") {
    return `${displayName}返回异常，请稍后重试。`;
  }
  if (errorCode === "timeout" || errorCode === "provider_unavailable") {
    return `${displayName}暂时无法同步，请稍后重试。`;
  }
  return `${displayName}同步失败，请稍后重试。`;
}

const publicSyncErrorCodes = new Set([
  "authentication",
  "rate_limited",
  "membership_required",
  "timeout",
  "provider_unavailable",
  "invalid_response",
  "sync_in_progress",
]);

function safeRetryAfterMs(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 86_400_000
    ? value
    : null;
}

async function safeErrorDetails(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: unknown;
      retryAfterMs?: unknown;
    };
    return {
      code:
        typeof body.error === "string" && publicSyncErrorCodes.has(body.error)
          ? body.error
          : null,
      retryAfterMs: safeRetryAfterMs(body.retryAfterMs),
    };
  } catch {
    return { code: null, retryAfterMs: null };
  }
}

function requestError(code: string, retryAfterMs: number | null = null) {
  const error = new Error(code) as Error & { retryAfterMs?: number | null };
  error.retryAfterMs = retryAfterMs;
  return error;
}

function syncOutcomeMessage(
  displayName: string,
  outcome: IntegrationStatus["sync"]["lastOutcome"],
) {
  if (!outcome) return null;
  if (outcome.kind === "succeeded_with_records") {
    return `${displayName}同步成功，已发现训练记录。`;
  }
  if (outcome.kind === "succeeded_empty") {
    return `${displayName}同步成功，本次未读取到训练记录。`;
  }
  return syncFailureMessage(
    displayName,
    outcome.errorCode ?? "provider_unavailable",
    outcome.retryAfterMs,
  );
}

export function IntegrationCard({
  trackerKey,
  definition,
  initialStatus,
}: {
  trackerKey: string;
  definition: IntegrationCardDefinition;
  initialStatus: IntegrationStatus;
}) {
  const queryClient = useContext(QueryClientContext);
  const [status, setStatus] = useState(initialStatus);
  const [previousInitialStatus, setPreviousInitialStatus] =
    useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"credential" | "sync" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryAvailableAt, setRetryAvailableAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [syncProgress, setSyncProgress] = useState<{
    from: string;
    to: string;
    targetDate: string;
    succeeded: number;
    failed: number;
  } | null>(null);
  const baseUrl = `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/${encodeURIComponent(definition.provider)}`;

  if (initialStatus !== previousInitialStatus) {
    setPreviousInitialStatus(initialStatus);
    setStatus(initialStatus);
  }

  useEffect(() => {
    queryClient?.setQueryData(
      integrationQueryKeys.providerStatus(trackerKey, definition.provider),
      status,
    );
  }, [definition.provider, queryClient, status, trackerKey]);

  useEffect(() => {
    if (retryAvailableAt === null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockNow(now);
      if (now >= retryAvailableAt) setRetryAvailableAt(null);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retryAvailableAt]);

  const retryAfterMsRemaining =
    retryAvailableAt === null ? 0 : Math.max(0, retryAvailableAt - clockNow);

  function markSyncInProgress() {
    setStatus((current) => ({
      ...current,
      sync: {
        ...current.sync,
        status: "running",
        lastOutcome: { kind: "in_progress" },
      },
    }));
    queryClient?.setQueryData(
      integrationQueryKeys.providerStatus(trackerKey, definition.provider),
      (current: unknown) => {
        const parsed = integrationStatusSchema.safeParse(current);
        return parsed.success
          ? {
              ...parsed.data,
              sync: { ...parsed.data.sync, status: "running" as const },
            }
          : current;
      },
    );
  }

  async function saveCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey) return;
    setBusy("credential");
    setMessage(null);
    try {
      const response = await fetch(`${baseUrl}/credential`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        const details = await safeErrorDetails(response);
        throw requestError(
          details.code ?? "credential_failed",
          details.retryAfterMs,
        );
      }
      const body: unknown = await response.json();
      setStatus(integrationStatusSchema.parse(body));
      setApiKey("");
      setMessage(`${definition.displayName}已连接。`);
    } catch (error) {
      const code =
        error instanceof Error && publicSyncErrorCodes.has(error.message)
          ? error.message
          : null;
      setMessage(
        code
          ? syncFailureMessage(definition.displayName, code)
          : "连接验证失败。原有凭证未被覆盖，请检查后重试。",
      );
    } finally {
      setBusy(null);
    }
  }

  async function syncToToday() {
    setBusy("sync");
    setMessage(null);
    setSyncProgress(null);
    let succeeded = 0;
    let failed = 0;
    let firstDate: string | null = null;
    let lastDate: string | null = null;
    let targetDate: string | null = null;
    let reachedTarget = false;
    let failureCode: string | null = null;
    let failureRetryAfterMs: number | null = null;
    let recordCount = 0;
    const seenCursors = new Set<string>();
    try {
      for (let batch = 0; batch < 64; batch += 1) {
        const response = await fetch(`${baseUrl}/sync`, { method: "POST" });
        if (!response.ok) {
          const details = await safeErrorDetails(response);
          throw requestError(
            details.code ?? "sync_failed",
            details.retryAfterMs,
          );
        }
        const body: unknown = await response.json();
        const result = integrationCatchUpResultSchema.parse(body);
        succeeded += result.summary.succeeded;
        failed += result.summary.failed;
        recordCount += result.days.reduce(
          (total, day) =>
            total + (day.status === "succeeded" ? day.recordCount : 0),
          0,
        );
        targetDate = result.targetDate;
        if (result.batch) {
          firstDate ??= result.batch.from;
          lastDate = result.batch.to;
          setSyncProgress({
            from: firstDate,
            to: lastDate,
            targetDate,
            succeeded,
            failed,
          });
        }
        const latestSuccess = [...result.days]
          .reverse()
          .find((day) => day.status === "succeeded");
        const failedDay = result.days.find((day) => day.status === "failed");
        if (failedDay?.retryAfterMs !== undefined) {
          setRetryAvailableAt(Date.now() + failedDay.retryAfterMs);
        }
        setStatus((current) => ({
          ...current,
          sync: {
            status: failedDay
              ? "failed"
              : result.complete
                ? failed > 0
                  ? "failed"
                  : "succeeded"
                : "running",
            lastAttemptAt: new Date().toISOString(),
            lastSucceededAt:
              latestSuccess?.status === "succeeded"
                ? latestSuccess.syncedAt
                : current.sync.lastSucceededAt,
            lastSucceededDate:
              result.lastSucceededDate ?? current.sync.lastSucceededDate,
            lastErrorCode: failedDay?.errorCode ?? null,
            lastOutcome: failedDay
              ? {
                  kind: "failed" as const,
                  errorCode: failedDay.errorCode,
                  ...(failedDay.retryAfterMs === undefined
                    ? {}
                    : { retryAfterMs: failedDay.retryAfterMs }),
                }
              : result.complete
                ? {
                    kind:
                      recordCount > 0
                        ? ("succeeded_with_records" as const)
                        : ("succeeded_empty" as const),
                  }
                : current.sync.lastOutcome,
          },
        }));
        if (failedDay) {
          failureCode = failedDay.errorCode;
          failureRetryAfterMs = failedDay.retryAfterMs ?? null;
          break;
        }
        if (!result.nextCursor) {
          reachedTarget = true;
          break;
        }
        if (seenCursors.has(result.nextCursor)) {
          throw new Error("sync_cursor_did_not_advance");
        }
        seenCursors.add(result.nextCursor);
        setMessage(
          `正在继续同步 ${result.nextCursor} 至 ${result.targetDate}…`,
        );
      }
      if (failureCode) {
        setMessage(
          syncFailureMessage(
            definition.displayName,
            failureCode,
            failureRetryAfterMs,
          ),
        );
      } else {
        setStatus((current) => ({
          ...current,
          sync: {
            ...current.sync,
            status: reachedTarget ? "succeeded" : "running",
          },
        }));
        setMessage(
          reachedTarget
            ? recordCount > 0
              ? `已同步到今天：成功 ${succeeded} 天，发现训练记录。`
              : `已同步到今天：成功 ${succeeded} 天，本次未读取到训练记录。`
            : `本次已同步：成功 ${succeeded} 天，失败 ${failed} 天。请继续同步。`,
        );
      }
    } catch (error) {
      const code =
        error instanceof Error && publicSyncErrorCodes.has(error.message)
          ? error.message
          : null;
      const retryAfterMs =
        error instanceof Error && "retryAfterMs" in error
          ? safeRetryAfterMs(error.retryAfterMs)
          : null;
      if (code === "sync_in_progress") markSyncInProgress();
      if (retryAfterMs !== null) {
        setRetryAvailableAt(Date.now() + retryAfterMs);
      }
      if (code !== "sync_in_progress") {
        setStatus((current) => ({
          ...current,
          sync: {
            ...current.sync,
            status: "failed",
            lastErrorCode: code ?? current.sync.lastErrorCode,
            lastOutcome:
              code === "sync_in_progress"
                ? { kind: "in_progress" as const }
                : code
                  ? { kind: "failed" as const, errorCode: code }
                  : current.sync.lastOutcome,
          },
        }));
      }
      setMessage(
        code
          ? syncFailureMessage(definition.displayName, code, retryAfterMs)
          : "同步没有完成，请稍后重试。",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="feedback-card integration-card">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">训练记录</p>
          <h2>{definition.displayName}</h2>
        </div>
        <span
          className={
            status.configured ? "integration-connected" : "integration-idle"
          }
        >
          {status.configured ? "已连接" : "未连接"}
        </span>
      </div>
      <p className="integration-description">{definition.description}</p>

      <form onSubmit={saveCredential} className="integration-form">
        <label htmlFor={`${definition.provider}-api-key`}>
          {status.configured ? "更新 API Key" : "API Key"}
        </label>
        <input
          id={`${definition.provider}-api-key`}
          type="password"
          value={apiKey}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            status.maskedKey ?? `输入${definition.displayName} API Key`
          }
        />
        <button type="submit" disabled={!apiKey || busy !== null}>
          {busy === "credential" ? "正在验证…" : "验证并保存"}
        </button>
      </form>

      <div className="integration-actions">
        <button
          type="button"
          disabled={
            !status.configured ||
            busy !== null ||
            status.sync.status === "running" ||
            retryAfterMsRemaining > 0
          }
          onClick={() => void syncToToday()}
        >
          {busy === "sync"
            ? "正在同步…"
            : retryAfterMsRemaining > 0
              ? `请等待 ${Math.ceil(retryAfterMsRemaining / 1_000)} 秒`
              : status.sync.status === "running"
                ? "另一项训记同步正在进行…"
                : "同步到今天"}
        </button>
        <p>
          最近成功日期：
          {status.sync.lastSucceededDate
            ? status.sync.lastSucceededDate
            : "暂无"}
        </p>
      </div>
      {syncProgress ? (
        <p className="integration-progress">
          本次范围：{syncProgress.from} 至 {syncProgress.targetDate}；已处理至
          {syncProgress.to}，成功 {syncProgress.succeeded} 天，失败
          {syncProgress.failed} 天。
        </p>
      ) : null}
      {message ||
      syncOutcomeMessage(
        definition.displayName,
        status.sync.lastOutcome ??
          (status.sync.status === "failed" && status.sync.lastErrorCode
            ? { kind: "failed", errorCode: status.sync.lastErrorCode }
            : undefined),
      ) ? (
        <p role="status" className="integration-message">
          {message ??
            syncOutcomeMessage(
              definition.displayName,
              status.sync.lastOutcome ??
                (status.sync.status === "failed" && status.sync.lastErrorCode
                  ? { kind: "failed", errorCode: status.sync.lastErrorCode }
                  : undefined),
            )}
        </p>
      ) : null}
    </section>
  );
}
