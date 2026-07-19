"use client";

import { useState } from "react";

import { clearCurrentUserClientState } from "@/offline/clear-private-client-state";
import { useOfflineCommands } from "@/offline/offline-command-context";

export function LocalDataCard() {
  const { commands } = useOfflineCommands();
  const [clearing, setClearing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="feedback-card local-data-card" aria-label="本机数据">
      <p className="eyebrow">隐私与离线</p>
      <h2>本机缓存</h2>
      <p>
        保存当前账号的白名单快照、安全规则和待同步任务/反馈。清除后不会删除云端数据。
      </p>
      {confirming ? (
        <p className="destructive-confirmation" role="alert">
          本机还有 {commands.length}{" "}
          条未完成同步的记录。再次确认会永久丢弃这些本机记录。
        </p>
      ) : null}
      <button
        className="secondary-button"
        type="button"
        disabled={clearing}
        onClick={async () => {
          if (commands.length > 0 && !confirming) {
            setConfirming(true);
            setMessage(null);
            return;
          }
          setClearing(true);
          setMessage(null);
          try {
            await clearCurrentUserClientState();
            setConfirming(false);
            setMessage("本机私人缓存已清除");
          } catch {
            setMessage("清除失败，请关闭并重新打开应用后再试");
          } finally {
            setClearing(false);
          }
        }}
      >
        {clearing
          ? "正在清除…"
          : confirming
            ? "确认丢弃并清除"
            : "清除本机数据"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
