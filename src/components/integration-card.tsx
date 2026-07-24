"use client";

import { useState } from "react";

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

function syncFailureMessage(displayName: string, errorCode: string) {
  if (errorCode === "authentication") {
    return `${displayName}连接已失效，请更新 API Key 后重试。`;
  }
  if (errorCode === "rate_limited") {
    return `${displayName}请求过于频繁，请稍后重试。`;
  }
  if (
    errorCode === "timeout" ||
    errorCode === "provider_unavailable" ||
    errorCode === "invalid_response"
  ) {
    return `${displayName}暂时无法同步，请稍后重试。`;
  }
  return `${displayName}同步失败，请稍后重试。`;
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
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"credential" | "sync" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    from: string;
    to: string;
    targetDate: string;
    succeeded: number;
    failed: number;
  } | null>(null);
  const baseUrl = `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/${encodeURIComponent(definition.provider)}`;

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
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("credential_failed");
      setStatus(integrationStatusSchema.parse(body));
      setApiKey("");
      setMessage(`${definition.displayName}已连接。`);
    } catch {
      setMessage("连接验证失败。原有凭证未被覆盖，请检查后重试。");
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
    const seenCursors = new Set<string>();
    try {
      for (let batch = 0; batch < 64; batch += 1) {
        const response = await fetch(`${baseUrl}/sync`, { method: "POST" });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("sync_failed");
        const result = integrationCatchUpResultSchema.parse(body);
        succeeded += result.summary.succeeded;
        failed += result.summary.failed;
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
          },
        }));
        if (failedDay) {
          failureCode = failedDay.errorCode;
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
        setMessage(syncFailureMessage(definition.displayName, failureCode));
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
            ? `已同步到今天：成功 ${succeeded} 天，失败 ${failed} 天。`
            : `本次已同步：成功 ${succeeded} 天，失败 ${failed} 天。请继续同步。`,
        );
      }
    } catch {
      setStatus((current) => ({
        ...current,
        sync: { ...current.sync, status: "failed" },
      }));
      setMessage("同步没有完成，请稍后重试。");
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
          disabled={!status.configured || busy !== null}
          onClick={() => void syncToToday()}
        >
          {busy === "sync" ? "正在同步…" : "同步到今天"}
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
      {message ? (
        <p role="status" className="integration-message">
          {message}
        </p>
      ) : null}
    </section>
  );
}
