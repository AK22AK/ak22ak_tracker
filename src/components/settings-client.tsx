"use client";

import { useQuery } from "@tanstack/react-query";

import {
  fetchGitHubMirrorStatus,
  fetchIntegrationStatus,
} from "@/client/integration-api";
import { integrationQueryKeys } from "@/client/query-keys";

import { GitHubMirrorCard } from "./github-mirror-card";
import { IntegrationCard } from "./integration-card";
import { LocalDataCard } from "./local-data-card";

const trackerKey = "knee-rehab";
const xunjiDefinition = {
  provider: "xunji",
  displayName: "训记",
  description: "只读同步力量训练动作、重量、组次与训练备注。",
} as const;

function SettingsSectionState({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      className="feedback-card page-section-loading"
      role={error ? "alert" : "status"}
    >
      <p>{error ? `${label}暂时无法加载。` : `正在加载${label}…`}</p>
      {error ? (
        <button className="secondary-button" type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
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
  const mirrorQuery = useQuery({
    queryKey: integrationQueryKeys.githubMirrorStatus(),
    queryFn: ({ signal }) => fetchGitHubMirrorStatus(signal),
    staleTime: 60_000,
  });

  return (
    <main className="app-shell page-frame" aria-label="设置页面">
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>设置</h1>
        </div>
      </header>
      {integrationQuery.data ? (
        <IntegrationCard
          trackerKey={trackerKey}
          definition={xunjiDefinition}
          initialStatus={integrationQuery.data}
        />
      ) : (
        <SettingsSectionState
          label="训练数据源"
          error={integrationQuery.isError}
          onRetry={() => void integrationQuery.refetch()}
        />
      )}
      {mirrorQuery.data ? (
        <GitHubMirrorCard initialStatus={mirrorQuery.data} />
      ) : (
        <SettingsSectionState
          label="私人数据镜像"
          error={mirrorQuery.isError}
          onRetry={() => void mirrorQuery.refetch()}
        />
      )}
      <LocalDataCard />
    </main>
  );
}
