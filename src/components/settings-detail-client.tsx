"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import {
  fetchDeepSeekConnectionStatus,
  fetchGarminConnectionStatus,
  fetchGarminWellnessProgress,
  fetchGitHubMirrorStatus,
  fetchIntegrationStatus,
} from "@/client/integration-api";
import { integrationQueryKeys } from "@/client/query-keys";

import { DeepSeekIntegrationCard } from "./deepseek-integration-card";
import { GarminIntegrationCard } from "./garmin-integration-card";
import { GitHubMirrorCard } from "./github-mirror-card";
import { HistorySyncCard } from "./history-sync-card";
import { IntegrationCard } from "./integration-card";
import { LocalDataCard } from "./local-data-card";
import { ShellViewportDiagnosticsPanel } from "./shell-viewport-diagnostics-panel";
import { SignOutButton } from "./sign-out-button";

const trackerKey = "knee-rehab";
const xunjiDefinition = {
  provider: "xunji",
  displayName: "训记",
  description: "同步力量训练的动作、重量、组次和备注。",
} as const;

export type SettingsDetail =
  | "garmin"
  | "xunji"
  | "history"
  | "deepseek"
  | "backup"
  | "storage"
  | "account";

const detailTitles: Record<SettingsDetail, string> = {
  garmin: "Garmin",
  xunji: "训记",
  history: "历史数据补录",
  deepseek: "DeepSeek",
  backup: "GitHub 数据备份",
  storage: "本机数据",
  account: "账号",
};

function SettingsDetailFrame({
  detail,
  children,
}: {
  detail: SettingsDetail;
  children: React.ReactNode;
}) {
  return (
    <main
      className="app-shell page-frame settings-detail-page"
      aria-label={`${detailTitles[detail]}设置`}
    >
      <header className="topbar settings-detail-header">
        <div>
          <p className="eyebrow">设置</p>
          <h1>{detailTitles[detail]}</h1>
        </div>
        <Link className="text-button" href="/settings">
          返回
        </Link>
      </header>
      {children}
    </main>
  );
}

function DetailLoading({ label }: { label: string }) {
  return (
    <section className="surface-card page-section-loading" role="status">
      正在加载{label}…
    </section>
  );
}

function DetailFailed({ label, retry }: { label: string; retry: () => void }) {
  return (
    <section className="surface-card settings-detail-error" role="alert">
      <p>{label}暂时无法加载。</p>
      <button className="secondary-button" onClick={retry} type="button">
        重试
      </button>
    </section>
  );
}

function GarminDetail() {
  const statusQuery = useQuery({
    queryKey: integrationQueryKeys.providerStatus(trackerKey, "garmin"),
    queryFn: ({ signal }) => fetchGarminConnectionStatus(trackerKey, signal),
    staleTime: 5 * 60_000,
  });
  const wellnessQuery = useQuery({
    queryKey: integrationQueryKeys.providerStatus(
      trackerKey,
      "garmin_wellness",
    ),
    queryFn: ({ signal }) => fetchGarminWellnessProgress(trackerKey, signal),
    staleTime: 60_000,
  });
  if (!statusQuery.data) {
    return statusQuery.isError ? (
      <DetailFailed label="Garmin" retry={() => void statusQuery.refetch()} />
    ) : (
      <DetailLoading label="Garmin" />
    );
  }
  return (
    <GarminIntegrationCard
      trackerKey={trackerKey}
      initialStatus={statusQuery.data}
      initialWellnessProgress={wellnessQuery.data}
    />
  );
}

function XunjiDetail() {
  const query = useQuery({
    queryKey: integrationQueryKeys.providerStatus(trackerKey, "xunji"),
    queryFn: ({ signal }) =>
      fetchIntegrationStatus(trackerKey, "xunji", signal),
    staleTime: 5 * 60_000,
  });
  if (!query.data) {
    return query.isError ? (
      <DetailFailed label="训记" retry={() => void query.refetch()} />
    ) : (
      <DetailLoading label="训记" />
    );
  }
  return (
    <IntegrationCard
      trackerKey={trackerKey}
      definition={xunjiDefinition}
      initialStatus={query.data}
    />
  );
}

function DeepSeekDetail() {
  const query = useQuery({
    queryKey: integrationQueryKeys.providerStatus(trackerKey, "deepseek"),
    queryFn: ({ signal }) => fetchDeepSeekConnectionStatus(trackerKey, signal),
    staleTime: 5 * 60_000,
  });
  if (!query.data) {
    return query.isError ? (
      <DetailFailed label="DeepSeek" retry={() => void query.refetch()} />
    ) : (
      <DetailLoading label="DeepSeek" />
    );
  }
  return (
    <DeepSeekIntegrationCard
      trackerKey={trackerKey}
      initialStatus={query.data}
    />
  );
}

function BackupDetail() {
  const query = useQuery({
    queryKey: integrationQueryKeys.githubMirrorStatus(),
    queryFn: ({ signal }) => fetchGitHubMirrorStatus(signal),
    staleTime: 60_000,
  });
  if (!query.data) {
    return query.isError ? (
      <DetailFailed
        label="GitHub 数据备份"
        retry={() => void query.refetch()}
      />
    ) : (
      <DetailLoading label="GitHub 数据备份" />
    );
  }
  return <GitHubMirrorCard initialStatus={query.data} />;
}

export function SettingsDetailClient({ detail }: { detail: SettingsDetail }) {
  let content: React.ReactNode;
  if (detail === "garmin") content = <GarminDetail />;
  else if (detail === "xunji") content = <XunjiDetail />;
  else if (detail === "history")
    content = <HistorySyncCard trackerKey={trackerKey} />;
  else if (detail === "deepseek") content = <DeepSeekDetail />;
  else if (detail === "backup") content = <BackupDetail />;
  else if (detail === "storage") content = <LocalDataCard />;
  else {
    content = (
      <section className="surface-card account-settings-card" aria-label="账号">
        <p className="eyebrow">账号</p>
        <h2>退出登录</h2>
        <p>退出会清除这台设备上的私人缓存与未同步记录。</p>
        <SignOutButton />
        <ShellViewportDiagnosticsPanel />
      </section>
    );
  }
  return <SettingsDetailFrame detail={detail}>{content}</SettingsDetailFrame>;
}
