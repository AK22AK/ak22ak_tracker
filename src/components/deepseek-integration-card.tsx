"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { deepSeekModelLabel } from "@/client/deepseek-model";
import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  deepSeekConnectionTestResultSchema,
  deepSeekConnectionStatusSchema,
  type DeepSeekConnectionStatus,
  type DeepSeekModel,
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

function testFailureMessage(code: string | null) {
  if (code === "authentication") {
    return "API Key 需要更新，请重新保存后再试。";
  }
  if (code === "rate_limited") return "请求较多，请稍后再试。";
  if (code === "timeout") return "测试超时，请稍后再试。";
  if (code === "provider_unavailable") {
    return "DeepSeek 暂时不可用，请稍后再试。";
  }
  return "DeepSeek 返回异常，请稍后再试。";
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
  const [model, setModel] = useState<DeepSeekModel>(initialStatus.model);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testReply, setTestReply] = useState<string | null>(null);
  const connected = status.hasCredential;
  const available = status.state === "connected";
  const busy = credentialBusy || modelBusy || testBusy;

  async function saveCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey || busy) return;
    setCredentialBusy(true);
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
      setModel(nextStatus.model);
      void queryClient.invalidateQueries({
        queryKey: trackerQueryKeys.planAdvice(trackerKey),
        exact: true,
      });
      setApiKey("");
      setMessage("DeepSeek 已连接。");
    } catch (error) {
      setMessage(
        failureMessage(
          error instanceof Error ? error.message : null,
          connected,
        ),
      );
    } finally {
      setCredentialBusy(false);
    }
  }

  async function saveModel() {
    if (busy || model === status.model) return;
    setModelBusy(true);
    setMessage(null);
    setTestMessage(null);
    setTestReply(null);
    try {
      const response = await fetch(
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/deepseek/preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        },
      );
      if (!response.ok) throw new Error("invalid_response");
      const nextStatus = deepSeekConnectionStatusSchema.parse(
        await response.json(),
      );
      queryClient.setQueryData(statusQueryKey, nextStatus);
      setModel(nextStatus.model);
      void queryClient.invalidateQueries({
        queryKey: trackerQueryKeys.planAdvice(trackerKey),
        exact: true,
      });
      setMessage(`已选择 ${deepSeekModelLabel(nextStatus.model)}。`);
    } catch {
      setMessage("模型选择尚未保存，请稍后重试。");
    } finally {
      setModelBusy(false);
    }
  }

  async function testModel() {
    if (!available || busy) return;
    setTestBusy(true);
    setTestMessage(null);
    setTestReply(null);
    try {
      const response = await fetch(
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/deepseek/test`,
        { method: "POST", headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error((await safeErrorCode(response)) ?? "invalid_response");
      }
      const result = deepSeekConnectionTestResultSchema.parse(
        await response.json(),
      );
      setTestMessage(`测试成功 · ${deepSeekModelLabel(result.model)}`);
      setTestReply(`DeepSeek 回复：${result.reply}`);
      void queryClient.invalidateQueries({
        queryKey: statusQueryKey,
        exact: true,
      });
    } catch (error) {
      setTestMessage(
        testFailureMessage(error instanceof Error ? error.message : null),
      );
    } finally {
      setTestBusy(false);
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
      <div className="integration-form deepseek-model-form">
        <label htmlFor="deepseek-model">建议模型</label>
        <select
          id="deepseek-model"
          value={model}
          disabled={busy}
          onChange={(event) => {
            setModel(event.target.value as DeepSeekModel);
            setTestMessage(null);
            setTestReply(null);
          }}
        >
          <option value="deepseek-v4-flash">Flash（日常建议）</option>
          <option value="deepseek-v4-pro">Pro（更深入）</option>
        </select>
        <button
          type="button"
          disabled={busy || model === status.model}
          onClick={() => void saveModel()}
        >
          {modelBusy ? "正在保存…" : "保存模型"}
        </button>
        <p className="integration-description">
          切换模型不会替换 API Key，也不会立即发出请求。
        </p>
      </div>
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
          {credentialBusy ? "正在验证…" : "验证并保存"}
        </button>
      </form>
      {available ? (
        <div className="integration-actions deepseek-actions">
          <button
            type="button"
            disabled={busy || model !== status.model}
            onClick={() => void testModel()}
          >
            {testBusy ? "正在测试…" : "测试当前模型"}
          </button>
          <Link className="secondary-button" href="/trends/advice">
            生成训练调整建议
          </Link>
        </div>
      ) : null}
      {available ? (
        <p className="integration-description">
          测试会发出一次很小的测试请求，不会生成训练建议。
        </p>
      ) : null}
      {message ? (
        <p className="integration-message" role="status">
          {message}
        </p>
      ) : null}
      {testMessage ? (
        <p className="integration-message" role="status">
          {testMessage}
        </p>
      ) : null}
      {testReply ? <p className="integration-message">{testReply}</p> : null}
    </section>
  );
}
