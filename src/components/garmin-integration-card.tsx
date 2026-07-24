"use client";

import { useRef, useState } from "react";

import {
  garminActivityPreviewResponseSchema,
  garminConnectionStatusSchema,
  garminProviderErrorCodeSchema,
  type GarminActivityPreviewResponse,
  type GarminConnectionStatus,
} from "@/domain/garmin";

const maxCredentialFileBytes = 140 * 1024;
const activityTypeLabels: Record<string, string> = {
  running: "跑步",
  walking: "步行",
  hiking: "徒步",
  cycling: "骑行",
  swimming: "游泳",
  strength_training: "力量训练",
};

function activityTypeLabel(activityType: string) {
  return activityTypeLabels[activityType] ?? "其他活动";
}

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
  if (code === "future_date_not_allowed") {
    return "验证日期不能晚于今天。";
  }
  if (code === "authentication") {
    return "Garmin Token 已失效，请在本机重新授权后导入。";
  }
  if (code === "rate_limited") {
    return "Garmin 请求过于频繁，请稍后再试。";
  }
  if (code === "timeout" || code === "provider_unavailable") {
    return "Garmin 暂时无法连接，请稍后再试。";
  }
  if (code === "invalid_token_bundle") {
    return "Token 文件无效，原有连接没有被替换。";
  }
  return "本次验证没有完成，请稍后再试。";
}

function durationLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

function paceLabel(seconds: number | null) {
  if (seconds === null) return null;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}'${String(rounded % 60).padStart(2, "0")}\"/km`;
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
  const [status, setStatus] = useState(initialStatus);
  const [previewDate, setPreviewDate] = useState(todayInPlanningTimeZone);
  const [preview, setPreview] = useState<GarminActivityPreviewResponse | null>(
    null,
  );
  const [busy, setBusy] = useState<"credential" | "preview" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage(
        "Token 已加密保存。浏览器无法删除本机文件，请手动运行 rm ~/.ak22ak_tracker/garmin-token-bundle.json 删除临时文件，再继续验证一天的活动。",
      );
    } catch (error) {
      setMessage(
        safeFailureMessage(error instanceof Error ? error.message : null),
      );
    } finally {
      setBusy(null);
    }
  }

  async function previewActivities() {
    setBusy("preview");
    setMessage(null);
    try {
      const response = await fetch(`${baseUrl}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: previewDate }),
      });
      if (!response.ok) {
        const code = await safeErrorCode(response);
        if (code === "authentication") {
          setStatus((current) => ({
            ...current,
            state: "needs_refresh",
            lastErrorCode: code,
          }));
        }
        throw new Error(code ?? "preview_failed");
      }
      const result = garminActivityPreviewResponseSchema.parse(
        await response.json(),
      );
      setStatus(result.connection);
      setPreview(result);
      setMessage(
        result.activities.length
          ? `已读取 ${result.activities.length} 条活动，仅供确认，尚未保存活动数据。`
          : "这一天没有读取到活动，尚未保存活动数据。",
      );
    } catch (error) {
      setPreview(null);
      setMessage(
        safeFailureMessage(error instanceof Error ? error.message : null),
      );
    } finally {
      setBusy(null);
    }
  }

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
        <label htmlFor="garmin-preview-date">验证日期</label>
        <input
          id="garmin-preview-date"
          type="date"
          value={previewDate}
          max={todayInPlanningTimeZone()}
          disabled={busy !== null}
          onChange={(event) => setPreviewDate(event.target.value)}
        />
        <button
          type="button"
          disabled={status.state === "not_connected" || busy !== null}
          onClick={() => void previewActivities()}
        >
          {busy === "preview" ? "正在读取…" : "预览这一天"}
        </button>
      </div>

      {preview ? (
        <div className="garmin-preview" aria-label="Garmin 活动预览">
          {preview.activities.length ? (
            <ul>
              {preview.activities.map((activity, index) => (
                <li key={`${activity.startedAt}-${index}`}>
                  <strong>{activityTypeLabel(activity.activityType)}</strong>
                  <span>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(activity.startedAt))}
                    · {durationLabel(activity.durationSeconds)}
                    {activity.distanceMeters === null
                      ? ""
                      : ` · ${(activity.distanceMeters / 1_000).toFixed(2)} km`}
                    {paceLabel(activity.averagePaceSecondsPerKilometer)
                      ? ` · ${paceLabel(activity.averagePaceSecondsPerKilometer)}`
                      : ""}
                    {activity.averageHeartRateBpm === null
                      ? ""
                      : ` · 平均心率 ${activity.averageHeartRateBpm}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>没有活动。</p>
          )}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="integration-message">
          {message}
        </p>
      ) : null}
    </section>
  );
}
