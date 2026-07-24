"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { integrationQueryKeys } from "@/client/query-keys";
import {
  githubMirrorStatusSchema,
  githubMirrorSyncResponseSchema,
  type GitHubMirrorStatus,
} from "@/domain/github-mirror";

function statusLabel(status: GitHubMirrorStatus) {
  if (status.configuration === "not_configured") return "未设置";
  if (status.configuration === "invalid_configuration") return "设置有误";
  if (status.permissionError || status.failedCount > 0) return "需要处理";
  if (status.processingCount > 0) return "备份中";
  if (status.pendingCount > 0) return "等待备份";
  return "已就绪";
}

export function GitHubMirrorCard({
  initialStatus,
}: {
  initialStatus: GitHubMirrorStatus;
}) {
  const queryClient = useQueryClient();
  const statusQueryKey = integrationQueryKeys.githubMirrorStatus();
  const { data: status } = useQuery({
    queryKey: statusQueryKey,
    queryFn: async () => {
      const response = await fetch("/api/mirror/status");
      if (!response.ok) throw new Error("mirror_status_failed");
      return githubMirrorStatusSchema.parse(await response.json());
    },
    initialData: initialStatus,
  });
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
      queryClient.setQueryData(statusQueryKey, parsed.status);
      setMessage(
        parsed.result.status === "not_configured"
          ? "尚未设置 GitHub 备份。"
          : parsed.result.status === "invalid_configuration"
            ? "GitHub 备份设置有误，请检查后重试。"
            : parsed.result.status === "unconfirmed"
              ? "这次备份尚未确认，记录会保留并稍后重试。"
              : parsed.result.failed > 0
                ? "部分记录没有备份成功，请稍后处理。"
                : parsed.result.processed > 0
                  ? `本次已备份 ${parsed.result.succeeded} 条。`
                  : "当前没有待备份记录。",
      );
    } catch {
      setMessage("GitHub 备份暂时不可用，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feedback-card mirror-card" aria-label="GitHub 数据备份">
      <div className="integration-heading">
        <div>
          <p className="eyebrow">数据备份</p>
          <h2>GitHub 私人仓库</h2>
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
        将训练和反馈备份到你的私人 GitHub 仓库。
      </p>
      <div className="mirror-summary">
        <strong>待备份 {status.pendingCount} 条</strong>
        <span>备份中 {status.processingCount} 条</span>
        <span>需要处理 {status.failedCount} 条</span>
      </div>
      {status.configuration === "invalid_configuration" ? (
        <p role="alert" className="task-save-message error">
          GitHub 备份设置有误，请检查设置后重试。
        </p>
      ) : status.permissionError ? (
        <p role="alert" className="task-save-message error">
          无法写入私人仓库，请检查仓库访问权限。
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
