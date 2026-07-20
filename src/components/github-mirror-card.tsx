"use client";

import { useState } from "react";

import {
  githubMirrorSyncResponseSchema,
  type GitHubMirrorStatus,
} from "@/domain/github-mirror";

function statusLabel(status: GitHubMirrorStatus) {
  if (status.configuration === "not_configured") return "未配置";
  if (status.configuration === "invalid_configuration") return "配置需处理";
  if (status.permissionError || status.failedCount > 0) return "需要处理";
  if (status.processingCount > 0) return "同步中";
  if (status.pendingCount > 0) return "等待同步";
  return "运行正常";
}

export function GitHubMirrorCard({
  initialStatus,
}: {
  initialStatus: GitHubMirrorStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/mirror/sync", { method: "POST" });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error("sync_failed");
      const parsed = githubMirrorSyncResponseSchema.parse(value);
      setStatus(parsed.status);
      setMessage(
        parsed.result.status === "not_configured"
          ? "尚未配置私人数据镜像。"
          : parsed.result.status === "invalid_configuration"
            ? "服务器镜像配置无效，需要处理后再同步。"
            : parsed.result.status === "unconfirmed"
              ? "本轮结果尚未确认，系统会保留记录并重新核对。"
              : parsed.result.failed > 0
                ? "本轮未能完成，已保留记录供后续处理。"
                : parsed.result.processed > 0
                  ? `本轮已镜像 ${parsed.result.succeeded} 条。`
                  : "当前没有到期的待镜像记录。",
      );
    } catch {
      setMessage("镜像服务暂时不可用，不影响已保存的训练和反馈。可稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feedback-card mirror-card" aria-label="私人数据镜像">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">数据归档</p>
          <h2>GitHub 私人镜像</h2>
        </div>
        <span
          className={
            status.configuration === "configured" &&
            status.failedCount === 0 &&
            !status.permissionError
              ? "integration-connected"
              : "integration-idle"
          }
        >
          {statusLabel(status)}
        </span>
      </div>
      <p className="integration-description">
        将已保存的结构化记录异步归档到私人数据仓库。镜像失败不会影响今日计划、训练或反馈。
      </p>
      <div className="mirror-summary">
        <strong>待镜像 {status.pendingCount} 条</strong>
        <span>处理中 {status.processingCount} 条</span>
        <span>需要处理 {status.failedCount} 条</span>
      </div>
      {status.configuration === "invalid_configuration" ? (
        <p role="alert" className="task-save-message error">
          服务器镜像配置无效，需要检查环境变量后再同步。
        </p>
      ) : status.permissionError ? (
        <p role="alert" className="task-save-message error">
          私人数据仓库权限需要处理，请检查服务端配置。
        </p>
      ) : status.failedCount > 0 ? (
        <p role="alert" className="task-save-message error">
          部分记录需要处理。已保存的训练和反馈不受影响。
        </p>
      ) : status.delayed ? (
        <p role="status" className="task-save-message">
          最早一条记录已等待超过 24 小时，可尝试立即同步。
        </p>
      ) : null}
      <button
        className="secondary-button"
        type="button"
        disabled={busy || status.configuration !== "configured"}
        onClick={() => void syncNow()}
      >
        {busy ? "正在同步…" : "立即同步"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
