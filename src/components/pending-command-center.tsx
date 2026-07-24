"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useNetworkState } from "@/client/use-network-state";
import type {
  PendingCommand,
  PendingCommandStatus,
} from "@/offline/command-contracts";
import { useOfflineCommands } from "@/offline/offline-command-context";

import { StatusPill } from "./ui/primitives";

const statusPresentation: Record<
  PendingCommandStatus,
  { label: string; tone: "neutral" | "brand" | "attention" | "warning" }
> = {
  local_only: { label: "仅保存在本机", tone: "neutral" },
  syncing: { label: "正在同步", tone: "brand" },
  retryable: { label: "等待重试", tone: "warning" },
  waiting_auth: { label: "等待重新验证", tone: "attention" },
  needs_attention: { label: "需要人工处理", tone: "attention" },
};

const timingLabels: Record<string, string> = {
  morning: "晨间反馈",
  pre_training: "训练前反馈",
  post_training: "训练后反馈",
  next_day: "次日反馈",
  incident: "突发反馈",
};

function commandTitle(command: PendingCommand) {
  return command.kind === "task_update" ? "任务更新" : "身体反馈";
}

function commandSummary(command: PendingCommand) {
  if (command.kind === "symptom_check_in") {
    const timing = timingLabels[command.payload.checkIn.timing] ?? "身体反馈";
    const safety = command.payload.localSafetyLevel
      ? ` · 本机预估${command.payload.localSafetyLevel === "green" ? "绿灯" : command.payload.localSafetyLevel === "yellow" ? "黄灯" : "红灯"}`
      : " · 等待安全判断";
    return `${timing}${safety}`;
  }
  if (command.payload.status === "completed") return "标记任务完成";
  if (command.payload.status === "skipped") return "标记任务跳过";
  return "恢复为待完成";
}

function safeErrorMessage(command: PendingCommand) {
  switch (command.lastErrorCode) {
    case "version_conflict":
      return "线上记录已经变化，请决定是否放弃这条本机修改。";
    case "invalid_command":
      return "这条本机记录无法按原意提交，需要人工处理。";
    case "target_not_found":
      return "对应的计划项目已不可用，需要人工处理。";
    case "invalid_response":
      return "这次保存结果无法确认，记录仍保留在本机。";
    case "authentication_required":
    case "forbidden":
      return "登录状态需要重新验证，记录仍保留在本机。";
    case "timeout":
      return "上次请求超时，可以重新尝试。";
    case "server_unavailable":
    case "network_error":
      return "上次同步未完成，可以重新尝试。";
    default:
      return command.status === "needs_attention"
        ? "这条记录需要你处理，本机内容会继续保留。"
        : null;
  }
}

function occurredTime(command: PendingCommand) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: command.occurredTimeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(command.occurredAt));
  } catch {
    return "时间待确认";
  }
}

export function PendingCommandCenter({ trackerKey }: { trackerKey: string }) {
  const online = useNetworkState();
  const { commands, replayNow, discardNeedsAttentionHead } =
    useOfflineCommands();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const relevant = useMemo(
    () =>
      commands
        .filter((command) => command.trackerKey === trackerKey)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        ),
    [commands, trackerKey],
  );

  async function retry() {
    if (!online || processing) return;
    setProcessing(true);
    setMessage(null);
    try {
      await replayNow();
    } catch {
      setMessage("重试尚未完成，本机记录仍然保留。请稍后再试。");
    } finally {
      setProcessing(false);
    }
  }

  async function confirmDiscard(commandId: string) {
    if (!online || processing) return;
    setProcessing(true);
    setMessage(null);
    try {
      await discardNeedsAttentionHead(commandId);
      setConfirmingId(null);
      setMessage("最早一条本机记录已放弃，页面已按最新数据更新。");
    } catch {
      setMessage("这条记录尚未放弃，本机内容保持不变，请稍后重试。");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className="app-shell page-frame pending-command-page">
      <header className="topbar pending-command-header">
        <div>
          <p className="eyebrow">隐私与离线</p>
          <h1>待同步记录</h1>
        </div>
        <Link className="text-button" href="/settings">
          返回设置
        </Link>
      </header>

      <section className="surface-card pending-command-intro">
        <div>
          <strong>{relevant.length} 条本机记录</strong>
          <p>最早一条处理完成后，后面的记录会继续同步。</p>
        </div>
        <StatusPill tone={online ? "success" : "warning"}>
          {online ? "当前在线" : "当前离线"}
        </StatusPill>
      </section>

      {relevant.length === 0 ? (
        <section className="surface-card pending-command-empty" role="status">
          <h2>没有待同步记录</h2>
          <p>任务和身体反馈都已保存。</p>
        </section>
      ) : (
        <section className="pending-command-list" aria-label="待同步记录">
          {relevant.map((command, index) => {
            const isHead = index === 0;
            const presentation = statusPresentation[command.status];
            const errorMessage = safeErrorMessage(command);
            return (
              <article
                className="surface-card pending-command-card"
                key={command.id}
                aria-label={`${commandTitle(command)}，${isHead ? "最早一条" : "等待前一条处理"}`}
              >
                <div className="pending-command-card-heading">
                  <div>
                    <span className="queue-position">
                      {isHead ? "最早一条" : "等待前一条"}
                    </span>
                    <h2>{commandTitle(command)}</h2>
                  </div>
                  <StatusPill tone={presentation.tone}>
                    {presentation.label}
                  </StatusPill>
                </div>
                <dl className="pending-command-facts">
                  <div>
                    <dt>计划日期</dt>
                    <dd>{command.localDate}</dd>
                  </div>
                  <div>
                    <dt>发生时间</dt>
                    <dd>{occurredTime(command)}</dd>
                  </div>
                </dl>
                <p className="pending-command-summary">
                  {commandSummary(command)}
                </p>
                {errorMessage ? (
                  <p className="pending-command-explanation">{errorMessage}</p>
                ) : null}

                {isHead && command.status === "syncing" ? (
                  <p className="pending-command-action-note" role="status">
                    正在同步，暂不可重复操作
                  </p>
                ) : null}
                {isHead &&
                (command.status === "retryable" ||
                  command.status === "waiting_auth" ||
                  command.status === "local_only") ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!online || processing}
                    onClick={() => void retry()}
                  >
                    {command.status === "waiting_auth"
                      ? "重新验证并重试"
                      : "立即重试"}
                  </button>
                ) : null}
                {isHead && command.status === "needs_attention" ? (
                  <div className="pending-command-discard">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!online || processing}
                      onClick={() => {
                        setConfirmingId(command.id);
                        setMessage(null);
                      }}
                    >
                      放弃本机记录
                    </button>
                    {!online ? (
                      <small>联网取得最新数据后才能放弃。</small>
                    ) : null}
                  </div>
                ) : null}
                {confirmingId === command.id ? (
                  <div className="pending-command-confirmation" role="alert">
                    <strong>确认放弃这条本机记录？</strong>
                    <p>会先取得最新数据，再移除这一条。后面的记录不会删除。</p>
                    <div>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={processing}
                        onClick={() => setConfirmingId(null)}
                      >
                        取消
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={processing}
                        onClick={() => void confirmDiscard(command.id)}
                      >
                        {processing ? "正在确认…" : "确认放弃"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
      {message ? (
        <p className="surface-card pending-command-message" role="status">
          {message}
        </p>
      ) : null}
    </main>
  );
}
