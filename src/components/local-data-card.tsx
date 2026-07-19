"use client";

import { useState } from "react";

import { clearCurrentUserClientState } from "@/offline/clear-private-client-state";

export function LocalDataCard() {
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="feedback-card local-data-card" aria-label="本机数据">
      <p className="eyebrow">隐私与离线</p>
      <h2>本机缓存</h2>
      <p>
        只保存当前账号的白名单只读快照。清除后不会删除云端计划、训练或反馈。
      </p>
      <button
        className="secondary-button"
        type="button"
        disabled={clearing}
        onClick={async () => {
          setClearing(true);
          setMessage(null);
          try {
            await clearCurrentUserClientState();
            setMessage("本机私人缓存已清除");
          } catch {
            setMessage("清除失败，请关闭并重新打开应用后再试");
          } finally {
            setClearing(false);
          }
        }}
      >
        {clearing ? "正在清除…" : "清除本机数据"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
