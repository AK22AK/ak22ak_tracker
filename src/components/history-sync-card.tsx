"use client";

import { useState } from "react";

import {
  providerHistoryDaysSchema,
  providerHistorySyncResultSchema,
  type ProviderHistoryDays,
  type ProviderHistoryScope,
  type ProviderHistorySyncResult,
} from "@/domain/integrations";

const scopes: Array<{ scope: ProviderHistoryScope; label: string }> = [
  { scope: "garmin_activity_history", label: "Garmin 活动" },
  { scope: "garmin_wellness_history", label: "Garmin 睡眠与步数" },
  { scope: "xunji_training_history", label: "训记训练" },
];

function failureMessage(code: string) {
  if (code === "authentication" || code === "credential_not_found") {
    return "连接需要更新，请先检查对应的数据来源。已完成的日期会保留。";
  }
  if (code === "rate_limited") {
    return "请求较多，请稍后继续。已完成的日期会保留。";
  }
  if (code === "sync_in_progress") {
    return "另一项同步正在进行，请稍后继续。";
  }
  return "本次同步没有完成，可以稍后继续。已完成的日期会保留。";
}

export function HistorySyncCard({ trackerKey }: { trackerKey: string }) {
  const [days, setDays] = useState<ProviderHistoryDays>(14);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<
    Partial<Record<ProviderHistoryScope, ProviderHistorySyncResult>>
  >({});
  const [errors, setErrors] = useState<
    Partial<Record<ProviderHistoryScope, string>>
  >({});

  async function sync() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const nextResults = { ...results };
    const nextErrors: Partial<Record<ProviderHistoryScope, string>> = {};
    try {
      for (const { scope } of scopes) {
        try {
          const response = await fetch(
            `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/history-sync/${scope}`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ days }),
            },
          );
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            const code =
              typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
                ? body.error
                : "sync_unavailable";
            throw new Error(code);
          }
          nextResults[scope] = providerHistorySyncResultSchema.parse(body);
        } catch (error) {
          nextErrors[scope] =
            error instanceof Error ? error.message : "sync_unavailable";
        }
        setResults({ ...nextResults });
        setErrors({ ...nextErrors });
      }
      const firstError = scopes
        .map(({ scope }) => nextErrors[scope])
        .find((error): error is string => Boolean(error));
      if (firstError) {
        setMessage(failureMessage(firstError));
        return;
      }
      const succeeded = Object.values(nextResults).reduce(
        (sum, result) => sum + (result?.summary.succeeded ?? 0),
        0,
      );
      const empty = Object.values(nextResults).reduce(
        (sum, result) => sum + (result?.summary.empty ?? 0),
        0,
      );
      const complete = scopes.every(
        ({ scope }) => nextResults[scope]?.complete === true,
      );
      setMessage(
        `${complete ? "所选范围已处理完成" : "本批已完成"}：成功 ${succeeded} 天，其中当天没有记录 ${empty} 天。${complete ? "" : "可继续同步剩余日期。"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card integration-card history-sync-card">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">历史数据补录</p>
          <h2>同步过去的记录</h2>
        </div>
      </div>
      <p className="integration-description">
        补录 Garmin
        活动、睡眠与步数和训记训练。每次只处理一小批，暂停后可以继续。
      </p>
      <div className="integration-form history-sync-controls">
        <label htmlFor="history-sync-days">补录范围</label>
        <select
          id="history-sync-days"
          value={days}
          disabled={busy}
          onChange={(event) =>
            setDays(providerHistoryDaysSchema.parse(Number(event.target.value)))
          }
        >
          <option value={7}>过去 7 天</option>
          <option value={14}>过去 14 天</option>
          <option value={30}>过去 30 天</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void sync()}>
          {busy ? "正在同步…" : `同步过去 ${days} 天`}
        </button>
      </div>
      <p className="integration-action-help">
        这不会改变正式计划开始日，也不会影响日常自动同步。
      </p>
      {Object.keys(results).length > 0 ? (
        <ul className="history-sync-progress" aria-label="历史同步进度">
          {scopes.map(({ scope, label }) => {
            const result = results[scope];
            const error = errors[scope];
            return (
              <li key={scope}>
                <strong>{label}</strong>
                <span>
                  {error
                    ? failureMessage(error)
                    : !result
                      ? "等待处理"
                      : result.complete
                        ? "已完成"
                        : result.nextCursor
                          ? `下次从 ${result.nextCursor} 继续`
                          : "本批已完成"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {message ? (
        <p className="integration-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
