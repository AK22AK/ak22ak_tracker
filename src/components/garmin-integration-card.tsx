"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  garminActivitySyncResponseSchema,
  garminConnectionStatusSchema,
  garminProviderErrorCodeSchema,
  type GarminConnectionStatus,
} from "@/domain/garmin";
import {
  integrationCatchUpResultSchema,
  type IntegrationCatchUpResult,
} from "@/domain/integrations";

const maxCredentialFileBytes = 140 * 1024;

function todayInPlanningTimeZone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function statusCopy(state: GarminConnectionStatus["state"]) {
  if (state === "connected") return "已连接";
  if (state === "needs_validation") return "待验证";
  if (state === "needs_refresh") return "需要更新";
  if (state === "invalid") return "需要处理";
  return "未连接";
}

function safeFailureMessage(code: string | null) {
  if (code === "future_date_not_allowed") return "同步日期不能晚于今天。";
  if (code === "authentication") {
    return "Garmin Token 已失效，请在本机重新授权后导入。";
  }
  if (code === "rate_limited") return "Garmin 请求过于频繁，请稍后再试。";
  if (code === "timeout" || code === "provider_unavailable") {
    return "Garmin 暂时无法连接，请稍后再试。";
  }
  if (code === "invalid_token_bundle") {
    return "Token 文件无效，原有连接没有被替换。";
  }
  return "本次同步没有完成，请稍后再试。";
}

async function safeErrorCode(response: Response) {
  try {
    const value = (await response.json()) as { error?: unknown };
    if (value.error === "future_date_not_allowed") return value.error;
    const parsed = garminProviderErrorCodeSchema.safeParse(value.error);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function GarminIntegrationCard({
  trackerKey,
  initialStatus,
}: {
  trackerKey: string;
  initialStatus: GarminConnectionStatus;
}) {
  const queryClient = useQueryClient();
  const statusQueryKey = integrationQueryKeys.providerStatus(
    trackerKey,
    "garmin",
  );
  const { data: status } = useQuery({
    queryKey: statusQueryKey,
    queryFn: async () => initialStatus,
    initialData: initialStatus,
    enabled: false,
  });
  const setStatus = (
    value:
      | GarminConnectionStatus
      | ((current: GarminConnectionStatus) => GarminConnectionStatus),
  ) => queryClient.setQueryData(statusQueryKey, value);
  const [syncDate, setSyncDate] = useState(todayInPlanningTimeZone);
  const [busy, setBusy] = useState<"credential" | "sync" | "catch_up" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [catchUpResult, setCatchUpResult] =
    useState<IntegrationCatchUpResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseUrl = `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin`;

  async function importCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    if (file.size > maxCredentialFileBytes) {
      setMessage("Token 文件过大，未进行导入。");
      return;
    }
    setBusy("credential");
    setMessage(null);
    try {
      const credential = JSON.parse(await file.text()) as unknown;
      const response = await fetch(`${baseUrl}/credential`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      if (!response.ok) {
        throw new Error((await safeErrorCode(response)) ?? "invalid_request");
      }
      const nextStatus = garminConnectionStatusSchema.parse(
        await response.json(),
      );
      setStatus(nextStatus);
      queryClient.setQueryData(
        integrationQueryKeys.providerStatus(trackerKey, "garmin"),
        nextStatus,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage(
        "Token 已加密保存。浏览器无法删除本机文件，请手动运行 rm ~/.ak22ak_tracker/garmin-token-bundle.json 删除临时文件，再同步一天的活动。",
      );
    } catch (error) {
      setMessage(
        safeFailureMessage(error instanceof Error ? error.message : null),
      );
    } finally {
      setBusy(null);
    }
  }

  async function syncActivities() {
    setBusy("sync");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: syncDate }),
        },
      );
      if (!response.ok) {
        const code = await safeErrorCode(response);
        if (code === "authentication") {
          setStatus((current) => ({
            ...current,
            state: "needs_refresh",
            lastErrorCode: code,
          }));
        }
        throw new Error(code ?? "sync_failed");
      }
      const result = garminActivitySyncResponseSchema.parse(
        await response.json(),
      );
      setStatus(result.connection);
      queryClient.setQueryData(
        integrationQueryKeys.providerStatus(trackerKey, "garmin"),
        result.connection,
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.today(trackerKey, syncDate),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.day(trackerKey, syncDate),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.calendar(trackerKey, syncDate.slice(0, 7)),
          exact: true,
        }),
      ]).catch(() => undefined);
      setMessage(
        result.sync.recordCount
          ? `已同步 ${result.sync.recordCount} 条活动，其中新增 ${result.sync.created} 条、更新 ${result.sync.changed} 条。`
          : "这一天没有活动记录。",
      );
    } catch (error) {
      setMessage(
        safeFailureMessage(error instanceof Error ? error.message : null),
      );
    } finally {
      setBusy(null);
    }
  }

  async function syncActivityHistory() {
    setBusy("catch_up");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin/sync`,
        { method: "POST" },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error("sync_failed");
      }
      const result = integrationCatchUpResultSchema.parse(body);
      setCatchUpResult(result);
      const failedDay = result.days.find((day) => day.status === "failed");
      setStatus((current) => ({
        ...current,
        state:
          failedDay?.errorCode === "authentication"
            ? "needs_refresh"
            : result.summary.succeeded > 0
              ? "connected"
              : current.state,
        lastErrorCode:
          failedDay &&
          garminProviderErrorCodeSchema.safeParse(failedDay.errorCode).success
            ? garminProviderErrorCodeSchema.parse(failedDay.errorCode)
            : null,
        sync: {
          status: failedDay
            ? "failed"
            : result.complete
              ? "succeeded"
              : "running",
          lastAttemptAt: new Date().toISOString(),
          lastSucceededDate:
            result.lastSucceededDate ?? current.sync?.lastSucceededDate ?? null,
          nextCursor: result.nextCursor,
          lastErrorCode:
            failedDay &&
            garminProviderErrorCodeSchema.safeParse(failedDay.errorCode).success
              ? garminProviderErrorCodeSchema.parse(failedDay.errorCode)
              : null,
        },
      }));
      const affectedDates = result.days
        .filter((day) => day.status === "succeeded")
        .map((day) => day.date);
      const affectedMonths = [
        ...new Set(affectedDates.map((date) => date.slice(0, 7))),
      ];
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: integrationQueryKeys.providerStatus(trackerKey, "garmin"),
          exact: true,
        }),
        ...affectedDates.flatMap((date) => [
          queryClient.invalidateQueries({
            queryKey: trackerQueryKeys.today(trackerKey, date),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: trackerQueryKeys.day(trackerKey, date),
            exact: true,
          }),
        ]),
        ...affectedMonths.map((month) =>
          queryClient.invalidateQueries({
            queryKey: trackerQueryKeys.calendar(trackerKey, month),
            exact: true,
          }),
        ),
      ]).catch(() => undefined);
      if (failedDay) {
        setMessage(safeFailureMessage(failedDay.errorCode));
      } else if (result.complete) {
        setMessage(`已同步到今天：本批成功 ${result.summary.succeeded} 天。`);
      } else {
        setMessage(`本批成功 ${result.summary.succeeded} 天，可以继续同步。`);
      }
    } catch {
      setMessage("同步没有完成，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  const catchUpFailure = catchUpResult?.days.find(
    (day) => day.status === "failed",
  );
  const catchUpButtonLabel =
    busy === "catch_up"
      ? "正在同步…"
      : catchUpFailure || status.sync?.status === "failed"
        ? "重试同步"
        : catchUpResult?.nextCursor || status.sync?.nextCursor
          ? "继续同步"
          : "同步活动记录";

  return (
    <section className="feedback-card integration-card">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">活动记录</p>
          <h2>Garmin</h2>
        </div>
        <span
          className={
            status.state === "connected"
              ? "integration-connected"
              : "integration-idle"
          }
        >
          {statusCopy(status.state)}
        </span>
      </div>
      <p className="integration-description">
        从本机生成并导入 Token；网页不会接收 Garmin 密码。
      </p>

      <form onSubmit={importCredential} className="integration-form">
        <label htmlFor="garmin-token-file">
          {status.state === "not_connected" ? "Token 文件" : "替换 Token 文件"}
        </label>
        <input
          ref={fileInputRef}
          id="garmin-token-file"
          type="file"
          accept="application/json,.json"
          disabled={busy !== null}
        />
        <button type="submit" disabled={busy !== null}>
          {busy === "credential" ? "正在保存…" : "导入并加密保存"}
        </button>
      </form>

      <div className="integration-actions garmin-preview-actions">
        <label htmlFor="garmin-sync-date">同步日期</label>
        <input
          id="garmin-sync-date"
          type="date"
          value={syncDate}
          max={todayInPlanningTimeZone()}
          disabled={busy !== null}
          onChange={(event) => setSyncDate(event.target.value)}
        />
        <button
          type="button"
          disabled={status.state === "not_connected" || busy !== null}
          onClick={() => void syncActivities()}
        >
          {busy === "sync" ? "正在同步…" : "同步这一天"}
        </button>
      </div>
      <div className="integration-actions garmin-catch-up-actions">
        <button
          type="button"
          disabled={status.state === "not_connected" || busy !== null}
          onClick={() => void syncActivityHistory()}
        >
          {catchUpButtonLabel}
        </button>
        <p>
          最近成功日期：
          {catchUpResult?.lastSucceededDate ??
            status.sync?.lastSucceededDate ??
            "暂无"}
        </p>
      </div>
      {catchUpResult?.batch ? (
        <div className="integration-progress" aria-label="活动同步进度">
          <p>
            本批范围：{catchUpResult.batch.from} 至 {catchUpResult.batch.to}；
            已处理至 {catchUpResult.batch.to}。
          </p>
          {catchUpFailure ? (
            <p>失败日期：{catchUpFailure.date}。处理后可从这一天重试。</p>
          ) : catchUpResult.nextCursor ? (
            <p>下一次从 {catchUpResult.nextCursor} 继续。</p>
          ) : (
            <p>已追赶到 {catchUpResult.targetDate}。</p>
          )}
        </div>
      ) : status.sync?.nextCursor ? (
        <p className="integration-progress">
          下一次从 {status.sync.nextCursor} 继续。
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
