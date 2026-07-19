"use client";

import { useState } from "react";

import {
  integrationStatusSchema,
  type IntegrationStatus,
} from "@/domain/integrations";
import { localDateInTimeZone } from "@/domain/planning-time";

export type IntegrationCardDefinition = {
  provider: string;
  displayName: string;
  description: string;
};

export function IntegrationCard({
  trackerKey,
  planningTimeZone,
  definition,
  initialStatus,
}: {
  trackerKey: string;
  planningTimeZone: string;
  definition: IntegrationCardDefinition;
  initialStatus: IntegrationStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"credential" | "sync" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
      setMessage("只读连接已验证并安全保存。");
    } catch {
      setMessage("连接验证失败。原有凭证未被覆盖，请检查后重试。");
    } finally {
      setBusy(null);
    }
  }

  async function syncToday() {
    setBusy("sync");
    setMessage(null);
    try {
      const date = localDateInTimeZone(new Date(), planningTimeZone);
      const response = await fetch(`${baseUrl}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!response.ok) throw new Error("sync_failed");
      setStatus((current) => ({
        ...current,
        sync: {
          status: "succeeded",
          lastAttemptAt: new Date().toISOString(),
          lastSucceededAt: new Date().toISOString(),
          lastErrorCode: null,
        },
      }));
      setMessage("今天的训练记录已同步。");
    } catch {
      setStatus((current) => ({
        ...current,
        sync: { ...current.sync, status: "failed" },
      }));
      setMessage("同步失败，但不会影响今日计划、反馈或手工记录。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="feedback-card integration-card">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">只读数据源</p>
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
          placeholder={status.maskedKey ?? "输入轮换后的 Key"}
        />
        <button type="submit" disabled={!apiKey || busy !== null}>
          {busy === "credential" ? "正在验证…" : "验证并保存"}
        </button>
      </form>

      <div className="integration-actions">
        <button
          type="button"
          disabled={!status.configured || busy !== null}
          onClick={() => void syncToday()}
        >
          {busy === "sync" ? "正在同步…" : "立即同步今天"}
        </button>
        <p>
          最近成功：
          {status.sync.lastSucceededAt
            ? new Date(status.sync.lastSucceededAt).toLocaleString("zh-CN")
            : "暂无"}
        </p>
      </div>
      {message ? (
        <p role="status" className="integration-message">
          {message}
        </p>
      ) : null}
    </section>
  );
}
