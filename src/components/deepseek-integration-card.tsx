"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  deepSeekConnectionStatusSchema,
  type DeepSeekConnectionStatus,
} from "@/domain/deepseek";

function statusCopy(state: DeepSeekConnectionStatus["state"]) {
  if (state === "connected") return "已连接";
  if (state === "needs_update") return "需要更新";
  if (state === "unavailable") return "暂时不可用";
  return "未连接";
}

async function safeErrorCode(response: Response) {
  try {
    const value = (await response.json()) as { error?: unknown };
    return typeof value.error === "string" ? value.error : null;
  } catch {
    return null;
  }
}

function failureMessage(code: string | null, hadConnection: boolean) {
  const prefix = hadConnection ? "原有连接没有被替换。" : "API Key 没有保存。";
  if (code === "authentication") {
    return `验证失败，${prefix}请检查 API Key 后重试。`;
  }
  if (code === "rate_limited") {
    return `请求较多，${prefix}请稍后重试。`;
  }
  if (code === "timeout" || code === "provider_unavailable") {
    return `DeepSeek 暂时无法连接，${prefix}请稍后重试。`;
  }
  return `验证没有完成，${prefix}请稍后重试。`;
}

export function DeepSeekIntegrationCard({
  trackerKey,
  initialStatus,
}: {
  trackerKey: string;
  initialStatus: DeepSeekConnectionStatus;
}) {
  const queryClient = useQueryClient();
  const statusQueryKey = integrationQueryKeys.providerStatus(
    trackerKey,
    "deepseek",
  );
  const { data: status } = useQuery({
    queryKey: statusQueryKey,
    queryFn: async () => initialStatus,
    initialData: initialStatus,
    enabled: false,
  });
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const connected = status.hasCredential;

  async function saveCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/deepseek/credential`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        },
      );
      if (!response.ok) {
        throw new Error((await safeErrorCode(response)) ?? "invalid_response");
      }
      const nextStatus = deepSeekConnectionStatusSchema.parse(
        await response.json(),
      );
      queryClient.setQueryData(statusQueryKey, nextStatus);
      void queryClient.invalidateQueries({
        queryKey: trackerQueryKeys.planAdvice(trackerKey),
        exact: true,
      });
      setApiKey("");
      setMessage("DeepSeek 已连接，可以在训练调整建议中开始分析。");
    } catch (error) {
      setMessage(
        failureMessage(
          error instanceof Error ? error.message : null,
          connected,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feedback-card integration-card">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">训练建议</p>
          <h2>DeepSeek</h2>
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
        API Key 验证成功后会加密保存，网页不会再次显示已保存的值。
      </p>
      <form className="integration-form" onSubmit={saveCredential}>
        <label htmlFor="deepseek-api-key">
          {connected ? "更新 DeepSeek API Key" : "DeepSeek API Key"}
        </label>
        <input
          id="deepseek-api-key"
          type="password"
          value={apiKey}
          autoComplete="off"
          disabled={busy}
          placeholder="输入 DeepSeek API Key"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <button type="submit" disabled={!apiKey || busy}>
          {busy ? "正在验证…" : "验证并保存"}
        </button>
      </form>
      {message ? (
        <p className="integration-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
