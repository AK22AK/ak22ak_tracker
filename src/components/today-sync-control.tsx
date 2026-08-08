"use client";

import { useState, type ReactNode } from "react";

import { syncLatestIntegrationRecords } from "@/client/integration-api";
import { useNetworkState } from "@/client/use-network-state";
import type { TodaySyncResult, TodaySyncSource } from "@/domain/today-sync";

import { AkToolbarAction } from "./ui/ak-konsta";

const sourceNames: Record<TodaySyncSource["source"], string> = {
  garmin_activity: "Garmin 活动",
  garmin_wellness: "Garmin 睡眠与步数",
  xunji_training: "训记",
};

function sourceStatusLabel(source: TodaySyncSource) {
  if (source.status === "records") {
    return source.continueAvailable ? "有记录 · 继续同步" : "有记录";
  }
  if (source.status === "no_records") {
    return source.continueAvailable
      ? "本次无新记录 · 继续同步"
      : "本次无新记录";
  }
  if (source.status === "temporarily_failed") return "暂时失败";
  if (source.status === "needs_credentials") return "需更新凭证";
  if (source.status === "not_connected") return "未连接";
  return "同步中";
}

function SourceResults({ result }: { result: TodaySyncResult }) {
  return (
    <ul className="today-sync-results" aria-label="来源同步结果">
      {result.sources.map((source) => (
        <li key={source.source} data-sync-source={source.source}>
          <span>{sourceNames[source.source]}</span>
          <strong>{sourceStatusLabel(source)}</strong>
        </li>
      ))}
    </ul>
  );
}

type TodaySyncController = {
  syncing: boolean;
  result: TodaySyncResult | null;
  failed: boolean;
  online: boolean;
  hasContinuation: boolean | undefined;
  syncStatus: string | null;
  sync: () => void;
};

function TodaySyncButton({ controller }: { controller: TodaySyncController }) {
  const { syncing, online, hasContinuation, sync } = controller;

  return (
    <AkToolbarAction
      className="today-sync-button"
      variant="tonal"
      label={syncing ? "正在同步外部训练记录" : "同步外部训练记录"}
      title={
        online
          ? hasContinuation
            ? "继续同步 Garmin、Garmin wellness 和训记"
            : "同步 Garmin、Garmin wellness 和训记"
          : "联网后同步外部训练记录"
      }
      disabled={syncing || !online}
      onClick={sync}
    >
      <span aria-hidden="true">⇄</span>
      <span>{syncing ? "同步中…" : "同步"}</span>
    </AkToolbarAction>
  );
}

function TodaySyncStatus({ controller }: { controller: TodaySyncController }) {
  const { syncing, result, failed, syncStatus } = controller;

  return (
    <>
      {syncing ? (
        <div className="today-sync-status" role="status" aria-live="polite">
          <strong>正在同步外部训练记录</strong>
          <ul className="today-sync-results" aria-label="来源同步结果">
            {Object.entries(sourceNames).map(([source, name]) => (
              <li key={source} data-sync-source={source}>
                <span>{name}</span>
                <strong>同步中</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result && syncStatus ? (
        <div className="today-sync-status" role="status" aria-live="polite">
          <strong>{syncStatus}</strong>
          <SourceResults result={result} />
        </div>
      ) : null}
      {failed ? (
        <p className="today-sync-error today-sync-status" role="alert">
          暂时无法同步，请稍后再试。
        </p>
      ) : null}
    </>
  );
}

export function TodaySyncControl({
  trackerKey,
  onCompleted,
  children,
}: {
  trackerKey: string;
  onCompleted: () => void | Promise<unknown>;
  children?: (parts: { button: ReactNode; status: ReactNode }) => ReactNode;
}) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<TodaySyncResult | null>(null);
  const [failed, setFailed] = useState(false);
  const online = useNetworkState();
  const hasContinuation = result?.sources.some(
    (source) => source.continueAvailable,
  );
  const recordCount =
    result?.sources.reduce((total, source) => total + source.recordCount, 0) ??
    0;
  const hasIncompleteSource = result?.sources.some(
    (source) => source.status !== "records" && source.status !== "no_records",
  );
  const syncStatus = result
    ? hasIncompleteSource
      ? recordCount > 0
        ? `已更新 ${recordCount} 条，部分来源未完成`
        : "部分来源未完成"
      : recordCount > 0
        ? `已更新 ${recordCount} 条`
        : "没有新的训练记录"
    : null;

  async function sync() {
    if (syncing || !online) return;
    setSyncing(true);
    setFailed(false);
    setResult(null);
    try {
      const nextResult = await syncLatestIntegrationRecords(trackerKey);
      setResult(nextResult);
      await onCompleted();
    } catch {
      setFailed(true);
    } finally {
      setSyncing(false);
    }
  }

  const controller: TodaySyncController = {
    syncing,
    result,
    failed,
    online,
    hasContinuation,
    syncStatus,
    sync: () => void sync(),
  };
  const button = <TodaySyncButton controller={controller} />;
  const status =
    syncing || (result && syncStatus) || failed ? (
      <TodaySyncStatus controller={controller} />
    ) : null;

  if (children) {
    return children({ button, status });
  }

  return (
    <div className="today-sync-control">
      {button}
      {status}
    </div>
  );
}
