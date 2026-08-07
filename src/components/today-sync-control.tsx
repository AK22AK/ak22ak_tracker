"use client";

import { useState } from "react";

import { syncLatestIntegrationRecords } from "@/client/integration-api";
import { useNetworkState } from "@/client/use-network-state";
import type { TodaySyncResult, TodaySyncSource } from "@/domain/today-sync";

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
    <ul className="today-sync-results" aria-label="最新记录同步结果">
      {result.sources.map((source) => (
        <li key={source.source} data-sync-source={source.source}>
          <span>{sourceNames[source.source]}</span>
          <strong>{sourceStatusLabel(source)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function TodaySyncControl({
  trackerKey,
  onCompleted,
}: {
  trackerKey: string;
  onCompleted: () => void | Promise<unknown>;
}) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<TodaySyncResult | null>(null);
  const [failed, setFailed] = useState(false);
  const online = useNetworkState();

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

  return (
    <section className="today-sync-control" aria-label="同步最新记录">
      <div className="today-sync-heading">
        <div>
          <strong>最新记录</strong>
          <p>补齐各来源尚未同步的记录。</p>
        </div>
        <button
          className="secondary-button today-sync-button"
          type="button"
          disabled={syncing || !online}
          onClick={() => void sync()}
        >
          {syncing ? "同步中…" : online ? "同步最新记录" : "联网后同步"}
        </button>
      </div>
      {syncing ? (
        <ul className="today-sync-results" aria-label="最新记录同步结果">
          {Object.entries(sourceNames).map(([source, name]) => (
            <li key={source} data-sync-source={source}>
              <span>{name}</span>
              <strong>同步中</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {result ? <SourceResults result={result} /> : null}
      {failed ? (
        <p className="today-sync-error" role="alert">
          暂时无法同步，请稍后再试。
        </p>
      ) : null}
    </section>
  );
}
