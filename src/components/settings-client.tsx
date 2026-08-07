"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchDeepSeekConnectionStatus,
  fetchGarminConnectionStatus,
  fetchGitHubMirrorStatus,
  fetchIntegrationStatus,
} from "@/client/integration-api";
import { integrationQueryKeys } from "@/client/query-keys";
import type { DeepSeekConnectionStatus } from "@/domain/deepseek";
import type { GarminConnectionStatus } from "@/domain/garmin";
import type { GitHubMirrorStatus } from "@/domain/github-mirror";
import type { IntegrationStatus } from "@/domain/integrations";

const trackerKey = "knee-rehab";

type RowStatus = { detail?: string; needsAttention: boolean };

const actionableIntegrationErrorCodes = new Set([
  "authentication",
  "membership_required",
]);

function garminRowStatus(status: GarminConnectionStatus): RowStatus {
  const syncErrorCode =
    status.sync?.status === "failed" ? status.sync.lastErrorCode : null;
  const errorCode = syncErrorCode ?? status.lastErrorCode;
  if (
    status.state === "needs_validation" ||
    status.state === "needs_refresh" ||
    status.state === "invalid" ||
    errorCode === "authentication" ||
    errorCode === "invalid_token_bundle" ||
    errorCode === "unsupported_client_version"
  ) {
    return { detail: "需要处理", needsAttention: true };
  }
  if (syncErrorCode === "timeout") {
    return { detail: "上次同步超时，将自动重试", needsAttention: false };
  }
  if (syncErrorCode === "provider_unavailable") {
    return { detail: "服务暂不可用，将自动重试", needsAttention: false };
  }
  if (syncErrorCode === "rate_limited") {
    return { detail: "请求较多，将自动重试", needsAttention: false };
  }
  if (syncErrorCode === "invalid_response") {
    return { detail: "响应异常，将自动重试", needsAttention: false };
  }
  if (status.state === "connected") return { needsAttention: false };
  return { detail: "尚未连接", needsAttention: false };
}

function integrationRowStatus(
  status: IntegrationStatus,
  now = Date.now(),
): RowStatus {
  const cooldown = status.sync.cooldown;
  if (cooldown) {
    const serverClockOffset = Date.parse(cooldown.serverNow) - now;
    const remainingMs = Math.max(
      0,
      Date.parse(cooldown.retryAvailableAt) - (now + serverClockOffset),
    );
    if (remainingMs === 0)
      return integrationRowStatus(
        {
          ...status,
          sync: { ...status.sync, cooldown: null },
        },
        now,
      );
    const seconds = Math.max(1, Math.ceil(remainingMs / 1_000));
    return cooldown.kind === "rate_limited"
      ? {
          detail: `训记要求等待，约 ${seconds} 秒后可重试`,
          needsAttention: false,
        }
      : {
          detail: `刚刚已同步，约 ${seconds} 秒后可再次同步`,
          needsAttention: false,
        };
  }
  if (status.sync.status === "failed") {
    const details: Record<string, string> = {
      authentication: "连接已失效，请更新 API Key",
      membership_required: "仅限 VIP 会员",
      rate_limited: "请求过于频繁，请稍后重试",
      invalid_response: "响应异常，将自动重试",
      timeout: "上次同步超时，将自动重试",
      provider_unavailable: "服务暂不可用，将自动重试",
      sync_in_progress: "同步进行中，将自动重试",
      provider_cooldown: "暂时等待，将自动重试",
    };
    const errorCode = status.sync.lastErrorCode ?? "";
    return {
      detail: details[errorCode] ?? "同步失败，请查看详情",
      needsAttention: actionableIntegrationErrorCodes.has(errorCode),
    };
  }
  if (status.sync.status === "running")
    return {
      detail:
        status.sync.lastOutcome?.kind === "in_progress"
          ? "另一项同步进行中"
          : "同步中",
      needsAttention: false,
    };
  if (status.sync.status === "succeeded") {
    if (status.sync.lastOutcome?.kind === "succeeded_with_records") {
      return { needsAttention: false };
    }
    if (status.sync.lastOutcome?.kind === "succeeded_empty") {
      return { needsAttention: false };
    }
  }
  if (status.configured) return { needsAttention: false };
  return { detail: "尚未连接", needsAttention: false };
}

function deepSeekRowStatus(status: DeepSeekConnectionStatus): RowStatus {
  if (status.state === "needs_update" || status.state === "unavailable") {
    return { detail: "需要处理", needsAttention: true };
  }
  if (status.state === "connected") return { needsAttention: false };
  return { detail: "尚未连接", needsAttention: false };
}

function mirrorRowStatus(status: GitHubMirrorStatus): RowStatus {
  if (
    status.configuration === "invalid_configuration" ||
    status.permissionError ||
    status.failedCount > 0
  ) {
    return { detail: "需要处理", needsAttention: true };
  }
  if (status.processingCount > 0 || status.pendingCount > 0) {
    return { detail: "备份中", needsAttention: false };
  }
  if (status.configuration === "configured") return { needsAttention: false };
  return { detail: "尚未设置", needsAttention: false };
}

function SettingsRow({
  href,
  name,
  detail,
  needsAttention = false,
}: {
  href: string;
  name: string;
  detail?: string;
  needsAttention?: boolean;
}) {
  return (
    <Link
      className="settings-row"
      data-needs-attention={needsAttention || undefined}
      href={href}
    >
      <span className="settings-row-copy">
        <strong>{name}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <span aria-hidden="true" className="settings-row-disclosure">
        ›
      </span>
    </Link>
  );
}

function SettingsSkeleton() {
  return (
    <section
      aria-label="正在加载设置…"
      className="settings-list-group"
      role="status"
    >
      <span className="sr-only">正在加载设置…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          className="settings-row-skeleton"
          data-testid="settings-row-skeleton"
          key={index}
        />
      ))}
    </section>
  );
}

export function SettingsClient() {
  const [clockNow, setClockNow] = useState(() => Date.now());
  const integrationQuery = useQuery({
    queryKey: integrationQueryKeys.providerStatus(trackerKey, "xunji"),
    queryFn: ({ signal }) =>
      fetchIntegrationStatus(trackerKey, "xunji", signal),
    staleTime: 5 * 60_000,
  });
  const garminQuery = useQuery({
    queryKey: integrationQueryKeys.providerStatus(trackerKey, "garmin"),
    queryFn: ({ signal }) => fetchGarminConnectionStatus(trackerKey, signal),
    staleTime: 5 * 60_000,
  });
  const deepSeekQuery = useQuery({
    queryKey: integrationQueryKeys.providerStatus(trackerKey, "deepseek"),
    queryFn: ({ signal }) => fetchDeepSeekConnectionStatus(trackerKey, signal),
    staleTime: 5 * 60_000,
  });
  const mirrorQuery = useQuery({
    queryKey: integrationQueryKeys.githubMirrorStatus(),
    queryFn: ({ signal }) => fetchGitHubMirrorStatus(signal),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!integrationQuery.data?.sync.cooldown) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [integrationQuery.data?.sync.cooldown]);

  const loading = [
    garminQuery,
    integrationQuery,
    deepSeekQuery,
    mirrorQuery,
  ].some((query) => query.isPending);
  const unavailableStatus = (failed: boolean): RowStatus => ({
    detail: failed ? "暂时无法加载" : "正在加载",
    needsAttention: failed,
  });
  const garminStatus = garminQuery.data
    ? garminRowStatus(garminQuery.data)
    : unavailableStatus(garminQuery.isError);
  const xunjiStatus = integrationQuery.data
    ? integrationRowStatus(integrationQuery.data, clockNow)
    : unavailableStatus(integrationQuery.isError);
  const deepSeekStatus = deepSeekQuery.data
    ? deepSeekRowStatus(deepSeekQuery.data)
    : unavailableStatus(deepSeekQuery.isError);
  const mirrorStatus = mirrorQuery.data
    ? mirrorRowStatus(mirrorQuery.data)
    : unavailableStatus(mirrorQuery.isError);
  const attentionCount = [
    garminStatus,
    xunjiStatus,
    deepSeekStatus,
    mirrorStatus,
  ].filter((status) => status.needsAttention).length;

  return (
    <main
      className="app-shell page-frame settings-shell"
      data-settings-shell="true"
      aria-label="设置页面"
    >
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>设置</h1>
        </div>
      </header>
      {attentionCount > 0 ? (
        <section className="settings-attention-summary" role="alert">
          <strong>{attentionCount} 项需要处理</strong>
          <span>请查看标有“需要处理”的项目。</span>
        </section>
      ) : null}
      {loading ? (
        <SettingsSkeleton />
      ) : (
        <div className="settings-groups">
          <section className="settings-list-group" aria-label="训练数据来源">
            <p className="settings-group-label">训练与恢复</p>
            <SettingsRow
              href="/settings/garmin"
              name="Garmin"
              {...garminStatus}
            />
            <SettingsRow href="/settings/xunji" name="训记" {...xunjiStatus} />
            <SettingsRow
              href="/settings/history"
              name="历史数据补录"
              detail="同步过去 7、14 或 30 天"
            />
          </section>
          <section className="settings-list-group" aria-label="建议与备份">
            <p className="settings-group-label">建议与备份</p>
            <SettingsRow
              href="/settings/deepseek"
              name="DeepSeek"
              {...deepSeekStatus}
            />
            <SettingsRow
              href="/settings/backup"
              name="GitHub 数据备份"
              {...mirrorStatus}
            />
          </section>
          <section className="settings-list-group" aria-label="本机与账号">
            <p className="settings-group-label">本机与账号</p>
            <SettingsRow
              href="/settings/storage"
              name="本机数据"
              detail="离线内容与待同步记录"
            />
            <SettingsRow
              href="/settings/account"
              name="账号"
              detail="退出登录"
            />
          </section>
        </div>
      )}
    </main>
  );
}
