"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { fetchProviderHistoryOverview } from "@/client/integration-api";
import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";

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

const sourceLabels = {
  garmin_activity: "Garmin 活动",
  garmin_wellness: "睡眠与步数",
  xunji_training: "训记",
} as const;
const maxHistoryRequestsPerScope = 10;

function failureMessage(code: string) {
  if (
    code === "authentication" ||
    code === "credential_not_found" ||
    code === "invalid_token_bundle" ||
    code === "unsupported_client_version"
  ) {
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
  const queryClient = useQueryClient();
  const [days, setDays] = useState<ProviderHistoryDays>(14);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<
    Partial<Record<ProviderHistoryScope, ProviderHistorySyncResult>>
  >({});
  const [errors, setErrors] = useState<
    Partial<Record<ProviderHistoryScope, string>>
  >({});
  const syncInFlight = useRef(false);
  const initializedDays = useRef(false);
  const overviewQuery = useQuery({
    queryKey: integrationQueryKeys.providerHistory(trackerKey),
    queryFn: ({ signal }) => fetchProviderHistoryOverview(trackerKey, signal),
    staleTime: 30_000,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (initializedDays.current || !overviewQuery.data?.range) return;
    initializedDays.current = true;
    setDays(overviewQuery.data.range.days);
  }, [overviewQuery.data?.range]);
  const noConnectedSources =
    overviewQuery.data?.scopes.every((scope) => !scope.connected) ?? false;

  async function sync() {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setBusy(true);
    setMessage(null);
    const nextResults = { ...results };
    const nextErrors: Partial<Record<ProviderHistoryScope, string>> = {};
    const affectedDates = new Set<string>();
    const connectedScopes = overviewQuery.data
      ? new Set(
          overviewQuery.data.scopes
            .filter((scope) => scope.connected)
            .map((scope) => scope.scope),
        )
      : null;
    const runnableScopes = connectedScopes
      ? scopes.filter(({ scope }) => connectedScopes.has(scope))
      : scopes;
    if (runnableScopes.length === 0) {
      setMessage("请先连接 Garmin 或训记，再补录历史记录。");
      syncInFlight.current = false;
      setBusy(false);
      return;
    }
    try {
      for (const { scope } of runnableScopes) {
        const requestLimit = maxHistoryRequestsPerScope;
        let previousCursor: string | null | undefined;
        for (
          let requestCount = 0;
          requestCount < requestLimit;
          requestCount += 1
        ) {
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
            const result = providerHistorySyncResultSchema.parse(body);
            nextResults[scope] = result;
            for (const day of result.days) {
              if (day.status === "succeeded") affectedDates.add(day.date);
            }
            setResults({ ...nextResults });
            setErrors({ ...nextErrors });
            if (
              result.complete ||
              result.summary.failed > 0 ||
              !result.nextCursor ||
              result.nextCursor === previousCursor
            ) {
              break;
            }
            previousCursor = result.nextCursor;
          } catch (error) {
            nextErrors[scope] =
              error instanceof Error ? error.message : "sync_unavailable";
            break;
          }
        }
        setResults({ ...nextResults });
        setErrors({ ...nextErrors });
      }
      const months = new Set<string>();
      await Promise.all(
        [...affectedDates].flatMap((localDate) => {
          months.add(localDate.slice(0, 7));
          return [
            queryClient.invalidateQueries({
              queryKey: trackerQueryKeys.today(trackerKey, localDate),
              exact: true,
            }),
            queryClient.invalidateQueries({
              queryKey: trackerQueryKeys.day(trackerKey, localDate),
              exact: true,
            }),
          ];
        }),
      );
      await Promise.all(
        [...months].map((month) =>
          queryClient.invalidateQueries({
            queryKey: trackerQueryKeys.calendar(trackerKey, month),
            exact: true,
          }),
        ),
      );
      await overviewQuery.refetch();
      const firstError = runnableScopes
        .map(({ scope }) => nextErrors[scope])
        .find((error): error is string => Boolean(error));
      if (firstError) {
        setMessage(failureMessage(firstError));
        return;
      }
      const complete = runnableScopes.every(
        ({ scope }) => nextResults[scope]?.complete === true,
      );
      setMessage(
        complete
          ? "所选范围已处理完成。最近一次补录结果已更新。"
          : "本次已推进到安全边界。未完成或失败的来源可以稍后继续。",
      );
    } finally {
      syncInFlight.current = false;
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
        <button
          type="button"
          disabled={busy || overviewQuery.isPending || noConnectedSources}
          onClick={() => void sync()}
        >
          {busy ? "正在同步…" : `同步过去 ${days} 天`}
        </button>
      </div>
      <p className="integration-action-help">
        这不会改变正式计划开始日，也不会影响日常自动同步。
      </p>
      {overviewQuery.isPending ? (
        <p className="integration-action-help" role="status">
          正在读取最近一次补录结果…
        </p>
      ) : overviewQuery.isError ? (
        <div className="history-sync-overview-error" role="alert">
          <p>最近一次补录结果暂时无法读取。</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void overviewQuery.refetch()}
          >
            重试
          </button>
        </div>
      ) : overviewQuery.data ? (
        <section
          className="history-sync-overview"
          aria-label="最近一次补录结果"
        >
          {overviewQuery.data.range ? (
            <>
              <div className="history-sync-overview-heading">
                <h3>最近一次补录</h3>
                <span>
                  {overviewQuery.data.range.from} 至{" "}
                  {overviewQuery.data.range.through}
                </span>
              </div>
              <p className="integration-action-help">
                已处理不等于当天有记录；只有“有记录”才表示当天读到了内容。
              </p>
              <ul className="history-sync-summary">
                {scopes.map(({ scope, label }) => {
                  const item = overviewQuery.data.scopes.find(
                    (candidate) => candidate.scope === scope,
                  );
                  if (!item) return null;
                  return (
                    <li key={scope}>
                      <strong>{label}</strong>
                      <span>
                        {`已处理 ${item.summary.processed} 天（有记录 ${item.summary.records} 天，空记录 ${item.summary.empty} 天） · 失败 ${item.summary.failed} 天 · 未处理 ${item.summary.unknown} 天`}
                      </span>
                      {!item.connected ? <small>当前未连接</small> : null}
                      {item.connected && item.nextCursor ? (
                        <small>
                          {item.status === "failed"
                            ? `${failureMessage(item.lastErrorCode ?? "sync_unavailable")} `
                            : ""}
                          下次从 {item.nextCursor} 继续
                        </small>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {overviewQuery.data.historyRecordDates.length > 0 ? (
                <div className="history-sync-record-dates">
                  <h3>本次补录有记录的日期</h3>
                  <ul>
                    {overviewQuery.data.historyRecordDates.map((item) => (
                      <li key={item.date}>
                        <Link href={`/calendar?date=${item.date}`}>
                          <strong>{item.date}</strong>
                          <span>
                            {item.sources
                              .map((source) => sourceLabels[source])
                              .join(" · ")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="integration-action-help">
                  本次补录中暂时没有读到可展示的记录。
                </p>
              )}
              {overviewQuery.data.savedRecordDates.length > 0 ? (
                <div className="history-sync-record-dates">
                  <h3>当前已保存的记录日期</h3>
                  <span>包括补录前由日常同步保存的记录。</span>
                  <ul>
                    {overviewQuery.data.savedRecordDates.map((item) => (
                      <li key={item.date}>
                        <Link href={`/calendar?date=${item.date}`}>
                          <strong>{item.date}</strong>
                          <span>
                            {item.sources
                              .map((source) => sourceLabels[source])
                              .join(" · ")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="integration-action-help">
                  当前范围内还没有已保存的记录。
                </p>
              )}
            </>
          ) : overviewQuery.data.scopes.some((scope) => scope.connected) ? (
            <p className="integration-action-help">还没有历史补录结果。</p>
          ) : (
            <p className="inline-notice" role="status">
              尚未连接 Garmin 或训记，请先完成连接。
            </p>
          )}
        </section>
      ) : null}
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
