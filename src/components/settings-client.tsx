"use client";

import Link from "next/link";
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

type RowStatus = { detail: string; needsAttention: boolean };

function garminRowStatus(status: GarminConnectionStatus): RowStatus {
  if (
    status.state === "needs_validation" ||
    status.state === "needs_refresh" ||
    status.state === "invalid" ||
    status.sync?.status === "failed"
  ) {
    return { detail: "需要处理", needsAttention: true };
  }
  if (status.state === "connected")
    return { detail: "已连接", needsAttention: false };
  return { detail: "未连接", needsAttention: false };
}

function integrationRowStatus(status: IntegrationStatus): RowStatus {
  if (status.sync.status === "failed") {
    return { detail: "需要处理", needsAttention: true };
  }
  if (status.sync.status === "running")
    return { detail: "同步中", needsAttention: false };
  if (status.configured) return { detail: "已连接", needsAttention: false };
  return { detail: "未连接", needsAttention: false };
}

function deepSeekRowStatus(status: DeepSeekConnectionStatus): RowStatus {
  if (status.state === "needs_update" || status.state === "unavailable") {
    return { detail: "需要处理", needsAttention: true };
  }
  if (status.state === "connected")
    return { detail: "已连接", needsAttention: false };
  return { detail: "未连接", needsAttention: false };
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
  if (status.configuration === "configured")
    return { detail: "已就绪", needsAttention: false };
  return { detail: "未设置", needsAttention: false };
}

function SettingsRow({
  href,
  name,
  detail,
  needsAttention = false,
}: {
  href: string;
  name: string;
  detail: string;
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
        <small>{detail}</small>
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
    ? integrationRowStatus(integrationQuery.data)
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
