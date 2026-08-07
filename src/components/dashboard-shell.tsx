"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type {
  ExternalRecordAssociation,
  ExternalTrainingRecord,
} from "@/domain/external-training";
import type { TaskActual } from "@/domain/schemas";
import { userFacingTaskTitle } from "@/domain/task-title";
import type { DashboardTask, TodayDashboard } from "@/server/dashboard";
import type { ExecutionContextToday } from "@/domain/execution-context";
import { useNetworkState } from "@/client/use-network-state";
import { useOfflineCommands } from "@/offline/offline-command-context";
import type { PendingProjectionSummary } from "@/offline/command-projection";
import { usePrivateOfflineIdentity } from "@/offline/private-offline-context";

import { ExternalTrainingSection } from "./external-training-section";
import { RecoveryReferenceCard } from "./recovery-reference-card";
import { TodaySyncControl } from "./today-sync-control";
import {
  ExecutionContextCard,
  ExecutionPauseCard,
} from "./execution-context-card";
import {
  SectionHeading,
  StatusPill,
  SurfaceCard,
  type StatusTone,
} from "./ui/primitives";

function formatStartDate(value: string | null) {
  if (!value) return "待设置";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00+08:00`));
}

function valueText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join("；");
  }
  return null;
}

function prescriptionExercises(prescription: Record<string, unknown>) {
  return Array.isArray(prescription.exercises)
    ? prescription.exercises.filter(
        (item): item is { name: string; dose: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).name === "string" &&
          typeof (item as Record<string, unknown>).dose === "string",
      )
    : [];
}

function taskDoseSummary(task: DashboardTask) {
  const exercises = prescriptionExercises(task.prescription);
  if (exercises.length === 1) {
    return `${exercises[0]!.name} · ${exercises[0]!.dose}`;
  }
  if (exercises.length > 1) {
    return `${exercises.length} 个动作 · ${exercises[0]!.name} ${exercises[0]!.dose}`;
  }
  for (const key of ["main", "target", "effort", "warmup"] as const) {
    const summary = valueText(task.prescription[key]);
    if (summary) return summary;
  }
  return task.description ?? "查看任务详情";
}

const taskStatusPresentation: Record<
  DashboardTask["status"],
  { label: string; tone: StatusTone; icon?: string }
> = {
  planned: { label: "待完成", tone: "attention" },
  completed: { label: "已完成", tone: "success", icon: "✓" },
  skipped: { label: "已跳过", tone: "neutral" },
};

function initialTaskActual(task: DashboardTask): TaskActual {
  if (task.actual) return task.actual;

  const exercises = prescriptionExercises(task.prescription);
  const kind =
    exercises.length > 0
      ? "exercise_list"
      : task.category.includes("run")
        ? "endurance"
        : "general";

  return {
    kind,
    exercises: exercises.map((exercise) => ({
      name: exercise.name,
      completed: false,
      actual: "",
    })),
    durationMinutes: null,
    distanceKm: null,
    summary: "",
  };
}

function nullableNumber(value: string) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function Prescription({
  prescription,
}: {
  prescription: Record<string, unknown>;
}) {
  const exercises = prescriptionExercises(prescription);
  const summaryKeys = [
    ["warmup", "热身"],
    ["effort", "强度"],
    ["main", "主训练"],
    ["target", "目标"],
    ["cooldown", "结束"],
    ["gate", "执行条件"],
    ["progression", "进阶"],
    ["substitution", "替换规则"],
    ["note", "说明"],
  ] as const;

  return (
    <div className="prescription">
      {summaryKeys.map(([key, label]) => {
        const text = valueText(prescription[key]);
        return text ? (
          <p key={key}>
            <strong>{label}</strong>
            {text}
          </p>
        ) : null;
      })}
      {exercises.length > 0 && (
        <ul>
          {exercises.map((exercise) => (
            <li key={`${exercise.name}-${exercise.dose}`}>
              <strong>{exercise.name}</strong>
              <span>{exercise.dose}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskCard({
  task,
  records,
  onUpdated,
  localDate,
  planVersion,
}: {
  task: DashboardTask;
  records: ExternalTrainingRecord[];
  onUpdated: (task: DashboardTask) => void;
  localDate: string;
  planVersion: number | null;
}) {
  const githubUserId = usePrivateOfflineIdentity();
  const { commands, confirmedCommandIds, enqueue, ready } =
    useOfflineCommands();
  const [note, setNote] = useState(task.subjectiveNote ?? "");
  const [actual, setActual] = useState(() => initialTaskActual(task));
  const [expansion, setExpansion] = useState<
    "default-open" | "closed" | "open"
  >(() => (task.status === "planned" ? "default-open" : "closed"));
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const pendingCommand = useRef<PendingClientCommand | null>(null);

  useEffect(() => {
    const commandId = pendingCommand.current?.metadata.commandId;
    if (!commandId) return;
    if (confirmedCommandIds?.includes(commandId)) {
      pendingCommand.current = null;
      setSaveFailed(false);
      setSaveMessage(task.status === "completed" ? "已保存并完成" : "已保存");
      return;
    }
    const command = commands.find((item) => item.id === commandId);
    if (!command) return;
    if (command.status === "needs_attention") {
      setSaveFailed(true);
      setSaveMessage("本机记录需要你处理，已停止自动重试");
    } else if (command.status === "waiting_auth") {
      setSaveFailed(true);
      setSaveMessage("请重新登录后重试，本机记录仍保留");
    } else if (command.status === "syncing") {
      setSaveFailed(false);
      setSaveMessage("已保存在本机，正在同步");
    } else if (command.status === "retryable") {
      setSaveFailed(false);
      setSaveMessage("仅保存在本机，等待自动重试");
    }
  }, [commands, confirmedCommandIds, task.status]);

  async function save(status: DashboardTask["status"], nextNote = note) {
    setSaving(true);
    setSaveMessage(null);
    setSaveFailed(false);
    try {
      const payload = {
        status,
        actual,
        note: nextNote || null,
      };
      const command = createOrReuseClientCommand(
        pendingCommand.current,
        payload,
      );
      pendingCommand.current = command;
      if (!githubUserId) throw new Error("offline_identity_unavailable");
      await enqueue({
        id: command.metadata.commandId,
        githubUserId,
        trackerKey: "knee-rehab",
        kind: "task_update",
        createdAt: command.metadata.occurredAt,
        occurredAt: command.metadata.occurredAt,
        localDate,
        occurredTimeZone: command.metadata.occurredTimeZone,
        occurredUtcOffsetMinutes: command.metadata.occurredUtcOffsetMinutes,
        payload: {
          taskId: task.id,
          status,
          actual,
          note: nextNote || null,
          baseStatus: task.status,
          planVersion,
        },
      });
      onUpdated({
        ...task,
        status,
        actual,
        subjectiveNote: nextNote || null,
      });
      setSaveMessage(
        navigator.onLine
          ? "已保存在本机，正在同步"
          : "仅保存在本机，联网后自动同步",
      );
    } catch {
      setSaveFailed(true);
      setSaveMessage("本机保存失败，请重试；本次修改尚未保存");
    } finally {
      setSaving(false);
    }
  }

  const status = taskStatusPresentation[task.status];
  const displayTitle = userFacingTaskTitle(task.title);
  const taskExpanded =
    expansion !== "closed" &&
    (task.status === "planned" || expansion === "open");
  const detailsId = `task-details-${task.id}`;

  return (
    <article
      className={`task-card ${task.status}`}
      data-status={task.status}
      aria-label={displayTitle}
    >
      <div className="task-card-summary">
        <label className="task-check" title={`标记${displayTitle}完成`}>
          <input
            type="checkbox"
            aria-label={displayTitle}
            checked={task.status === "completed"}
            disabled={saving || !ready}
            onChange={(event) =>
              save(event.target.checked ? "completed" : "planned")
            }
          />
          <span className="task-check-box" aria-hidden="true" />
        </label>
        <button
          className="task-summary-button"
          type="button"
          aria-expanded={taskExpanded}
          aria-controls={detailsId}
          aria-label={`${taskExpanded ? "收起" : "展开"} ${displayTitle}`}
          onClick={() =>
            setExpansion((value) => {
              if (task.status === "planned") {
                return value === "closed" ? "open" : "closed";
              }
              return value === "open" ? "closed" : "open";
            })
          }
        >
          <span className="task-summary-copy">
            <strong>{displayTitle}</strong>
            <span>{taskDoseSummary(task)}</span>
          </span>
          <span className="task-expand-icon" aria-hidden="true">
            {taskExpanded ? "⌃" : "⌄"}
          </span>
        </button>
        <StatusPill tone={status.tone} icon={status.icon}>
          {status.label}
        </StatusPill>
      </div>
      {records.length > 0 ? (
        <div className="task-linked-source-summary">
          <span>
            已关联 {records.length} 条来源 ·{" "}
            {[
              ...new Set(
                records.map((record) =>
                  record.provider === "xunji" ? "训记" : "Garmin",
                ),
              ),
            ].join("、")}
          </span>
          <Link href={`/calendar?date=${localDate}`} scroll={false}>
            日历中查看
          </Link>
        </div>
      ) : null}
      {taskExpanded ? (
        <div className="task-card-details" id={detailsId}>
          <div className="task-detail-block">
            <h3>训练内容</h3>
            {task.description ? (
              <p className="task-description">{task.description}</p>
            ) : null}
            <Prescription prescription={task.prescription} />
          </div>

          <div className="manual-entry-fallback">
            <button
              className="manual-entry-toggle"
              type="button"
              aria-expanded={manualEntryOpen}
              onClick={() => setManualEntryOpen((value) => !value)}
            >
              <span>没有同步记录？手工记录</span>
              <span aria-hidden="true">{manualEntryOpen ? "−" : "+"}</span>
            </button>
            {manualEntryOpen ? (
              <div className="manual-entry-content">
                <div className="task-actual">
                  <strong>实际完成情况</strong>
                  {actual.kind === "exercise_list" ? (
                    <div className="actual-exercise-list">
                      {actual.exercises.map((exercise, index) => (
                        <div
                          className="actual-exercise"
                          key={`${exercise.name}-${index}`}
                        >
                          <label>
                            <input
                              type="checkbox"
                              checked={exercise.completed}
                              disabled={saving || !ready}
                              onChange={(event) =>
                                setActual((current) => ({
                                  ...current,
                                  exercises: current.exercises.map(
                                    (item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            completed: event.target.checked,
                                          }
                                        : item,
                                  ),
                                }))
                              }
                            />
                            {exercise.name}
                          </label>
                          <input
                            value={exercise.actual}
                            maxLength={500}
                            disabled={saving || !ready}
                            aria-label={`${exercise.name}实际重量组次`}
                            placeholder="例如 40 kg，2×10"
                            onChange={(event) =>
                              setActual((current) => ({
                                ...current,
                                exercises: current.exercises.map(
                                  (item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, actual: event.target.value }
                                      : item,
                                ),
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {actual.kind === "endurance" ? (
                    <>
                      <div className="actual-number-grid">
                        <label>
                          实际时长（分钟）
                          <input
                            type="number"
                            min="0"
                            max="1440"
                            step="1"
                            value={actual.durationMinutes ?? ""}
                            disabled={saving || !ready}
                            onChange={(event) =>
                              setActual((current) => ({
                                ...current,
                                durationMinutes: nullableNumber(
                                  event.target.value,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label>
                          实际距离（km）
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            step="0.01"
                            value={actual.distanceKm ?? ""}
                            disabled={saving || !ready}
                            onChange={(event) =>
                              setActual((current) => ({
                                ...current,
                                distanceKm: nullableNumber(event.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>
                      <label>
                        实际跑步／跑走结构
                        <input
                          value={actual.summary}
                          maxLength={2000}
                          disabled={saving || !ready}
                          placeholder="例如跑 2 分钟、走 1 分钟，共 6 轮"
                          onChange={(event) =>
                            setActual((current) => ({
                              ...current,
                              summary: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  {actual.kind === "general" ? (
                    <label>
                      实际训练内容
                      <input
                        value={actual.summary}
                        maxLength={2000}
                        disabled={saving || !ready}
                        placeholder="记录实际完成的内容"
                        onChange={(event) =>
                          setActual((current) => ({
                            ...current,
                            summary: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
                <label className="task-note">
                  实际训练与主观感受
                  <textarea
                    value={note}
                    maxLength={2000}
                    placeholder="例如：实际重量、组数、哪里不舒服、为什么调整了训练"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving || !ready}
                  onClick={() => save(task.status)}
                >
                  {saving ? "保存中…" : "保存训练记录"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="task-secondary-actions">
            <button
              className="text-button"
              type="button"
              disabled={saving || !ready}
              onClick={() =>
                save(task.status === "skipped" ? "planned" : "skipped")
              }
            >
              {task.status === "skipped" ? "恢复为待完成" : "今天跳过"}
            </button>
          </div>
        </div>
      ) : null}
      {saveMessage ? (
        <p
          className={`task-save-message ${saveFailed ? "error" : "success"}`}
          role="status"
        >
          {saveMessage}
        </p>
      ) : null}
    </article>
  );
}

function taskIdForRecord(
  record: ExternalTrainingRecord,
  tasks: DashboardTask[],
) {
  const taskId = record.association?.taskId ?? record.suggestion?.taskId;
  return taskId && tasks.some((task) => task.id === taskId) ? taskId : null;
}

function safetyTone(level: "green" | "yellow" | "red"): StatusTone {
  if (level === "red") return "danger";
  if (level === "yellow") return "warning";
  return "success";
}

function safetyLabel(level: "green" | "yellow" | "red") {
  if (level === "red") return "红灯";
  if (level === "yellow") return "黄灯";
  return "绿灯";
}

function safetyGuidance(level: "green" | "yellow" | "red") {
  if (level === "red") {
    return "停止相关诱发负荷；若未迅速恢复或反复出现，应联系专业人员。";
  }
  if (level === "yellow") {
    return "今天不要升级，优先回到上一绿灯水平或减少最近增量。";
  }
  return "当前反馈支持维持计划；升级仍需连续满足计划条件。";
}

function executionExceptionLabel(execution: ExecutionContextToday) {
  if (execution.resumption?.status === "pending") return "待接续评估";
  if (execution.pause?.status === "active") return "暂停模式";
  if (execution.pause?.status === "pending_resume_assessment") {
    return "待接续评估";
  }
  const context = execution.context;
  if (!context) return null;
  if (context.status === "upcoming") {
    return context.kind === "travel" ? "已安排出差" : "已安排器械受限";
  }
  return context.kind === "travel" ? "出差维持模式" : "器械受限模式";
}

export function DashboardShell({
  today,
  localDate,
  planVersion,
  planStartsToday,
  initialDashboard,
  execution,
  onRefresh,
  onLatestSyncCompleted,
  onExecutionChanged,
  onTaskUpdated,
  onExternalTrainingUpdated,
  onExternalTrainingConflict,
  readOnlyOffline = false,
  offlineSavedAt = null,
  pendingSummary = null,
  onRetryPending,
}: {
  today: string;
  localDate: string;
  planVersion: number | null;
  planStartsToday: boolean;
  initialDashboard: TodayDashboard;
  execution: ExecutionContextToday;
  onRefresh: () => Promise<unknown>;
  onLatestSyncCompleted: () => Promise<unknown>;
  onExecutionChanged: () => Promise<unknown>;
  onTaskUpdated: (task: DashboardTask) => void;
  onExternalTrainingUpdated: (
    recordId: string,
    association: ExternalRecordAssociation,
  ) => void | Promise<void>;
  onExternalTrainingConflict: () => void | Promise<void>;
  readOnlyOffline?: boolean;
  offlineSavedAt?: string | null;
  pendingSummary?: PendingProjectionSummary | null;
  onRetryPending: () => Promise<void>;
}) {
  const online = useNetworkState();
  const writesDisabled = readOnlyOffline || !online;
  const refreshingFromLocal = online && readOnlyOffline;
  const [refreshing, setRefreshing] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [associationFeedback, setAssociationFeedback] = useState<string | null>(
    null,
  );

  const tasks = initialDashboard.tasks;
  const feedbackCount = initialDashboard.feedbackCount;
  const completedCount = tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const remainingCount = tasks.filter(
    (task) => task.status === "planned",
  ).length;
  const notStarted = initialDashboard.state === "not_started";
  const missing = initialDashboard.state === "missing";
  const baselineDay =
    planStartsToday && !missing && !notStarted && tasks.length === 0;
  const latestSafety = initialDashboard.feedbacks.at(-1)?.safetyLevel ?? null;
  const currentSafety = latestSafety;
  const externalRecords = initialDashboard.externalTrainingRecords;
  const pendingRecords = externalRecords.filter(
    (record) =>
      !record.association ||
      record.association.status === "suggested" ||
      record.association.needsReview,
  );
  const confirmedRecords = externalRecords.filter(
    (record) =>
      record.association?.status === "confirmed" &&
      !record.association.needsReview,
  );
  const adjustmentException = executionExceptionLabel(execution);
  const adjustmentPanelId = "today-adjustments";
  const forceAdjustmentPanel =
    execution.safety.blocked || Boolean(execution.pause);
  const adjustmentPanelOpen = adjustmentsOpen || forceAdjustmentPanel;

  const handleExternalTrainingUpdated = async (
    recordId: string,
    association: ExternalRecordAssociation,
  ) => {
    const record = externalRecords.find((item) => item.id === recordId);
    const source = record?.provider === "xunji" ? "训记训练" : "Garmin 活动";
    const task = tasks.find((item) => item.id === association.taskId);
    setAssociationFeedback(
      association.status === "unrelated"
        ? `${source}已标记与计划无关，已从今日待处理移除；可在日历当天修改。`
        : `${source}已关联到“${task ? userFacingTaskTitle(task.title) : "计划任务"}”；任务完成状态未改变，可在日历当天修改。`,
    );
    await onExternalTrainingUpdated(recordId, association);
  };

  const planTitle = missing
    ? "等待导入私人计划"
    : notStarted
      ? `计划将于 ${formatStartDate(initialDashboard.startDate)}开始`
      : tasks.length === 0
        ? baselineDay
          ? "第 1 周从今天开始"
          : "今天没有安排训练"
        : remainingCount > 0
          ? `今天还剩 ${remainingCount} 项`
          : "今天的任务已处理";

  return (
    <main className="app-shell today-page" data-today-content-visible="true">
      <header className="today-header">
        <div className="today-title-row">
          <div>
            <p className="eyebrow">AK Tracker</p>
            <h1>{today}</h1>
          </div>
          <button
            className="refresh-button"
            type="button"
            aria-label={refreshing ? "正在刷新今日数据" : "刷新今日数据"}
            title={online ? "刷新今日数据" : "联网后刷新"}
            disabled={!online || refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      </header>

      {writesDisabled ? (
        <section className="offline-cache-notice" role="status">
          <strong>
            {refreshingFromLocal
              ? "正在获取最新内容"
              : readOnlyOffline
                ? "当前离线 · 显示本机内容"
                : "当前离线"}
          </strong>
          <span>
            {refreshingFromLocal
              ? "暂时显示本机内容 · 最近更新："
              : "最近更新："}
            {offlineSavedAt
              ? new Intl.DateTimeFormat("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(offlineSavedAt))
              : "未知"}
          </span>
          <small>
            {refreshingFromLocal
              ? "更新完成后，可以继续使用需要联网的操作。"
              : "任务和身体反馈可先保存到本机，其他操作请联网后进行。"}
          </small>
        </section>
      ) : null}

      {associationFeedback ? (
        <section className="association-feedback" role="status">
          {associationFeedback}
        </section>
      ) : null}

      {pendingSummary &&
      pendingSummary.localOnly +
        pendingSummary.syncing +
        pendingSummary.retryable +
        pendingSummary.waitingAuth +
        pendingSummary.needsAttention >
        0 ? (
        <section className="offline-command-status" role="status">
          <strong>
            {pendingSummary.headStatus === "needs_attention"
              ? `${pendingSummary.needsAttention} 条需要人工处理`
              : pendingSummary.headStatus === "waiting_auth"
                ? `${pendingSummary.waitingAuth} 条等待重新验证`
                : pendingSummary.headStatus === "retryable"
                  ? `${pendingSummary.retryable} 条等待重试`
                  : pendingSummary.headStatus === "syncing"
                    ? `${pendingSummary.syncing} 条正在同步`
                    : `${pendingSummary.localOnly} 条仅保存在本机`}
          </strong>
          {pendingSummary.headStatus === "needs_attention" ? (
            <span>最早一条记录需要你处理，后面的记录会暂时等待。</span>
          ) : null}
          {pendingSummary.unclassifiedFeedback > 0 ? (
            <span>身体反馈尚未完成安全判断，请先按保守原则处理。</span>
          ) : null}
          {online && pendingSummary.canRetryNow ? (
            <button
              className="text-button"
              type="button"
              onClick={() => void onRetryPending()}
            >
              立即重试
            </button>
          ) : null}
        </section>
      ) : null}

      {currentSafety && currentSafety !== "green" ? (
        <section
          className={`safety-banner ${currentSafety}`}
          role="alert"
          aria-label={`${safetyLabel(currentSafety)}安全提示`}
        >
          <StatusPill
            tone={safetyTone(currentSafety)}
            icon={currentSafety === "red" ? "×" : "!"}
          >
            {safetyLabel(currentSafety)}
          </StatusPill>
          <p>{safetyGuidance(currentSafety)}</p>
        </section>
      ) : null}

      {execution.resumption?.status === "pending" ? (
        <SurfaceCard className="resumption-entry-card" aria-label="待接续评估">
          <SectionHeading
            eyebrow="计划接续"
            title="中断结束后需要确认怎样继续"
            aside={
              <StatusPill tone="attention" icon="!">
                待确认
              </StatusPill>
            }
          />
          <p>查看中断情况和后续日期变化，再决定按原计划继续或顺延。</p>
          {writesDisabled ? (
            <span className="secondary-button" aria-disabled="true">
              联网后处理接续评估
            </span>
          ) : (
            <Link
              className="primary-button"
              href={`/resumption/${execution.resumption.id}`}
              scroll={false}
            >
              查看接续评估
            </Link>
          )}
        </SurfaceCard>
      ) : null}

      {adjustmentException ? (
        <section className="today-exception-entry" role="status">
          <div>
            <strong>{adjustmentException}</strong>
            <span>
              {execution.pause
                ? "今天的训练安排已暂停。"
                : "今天的安排会按这个临时条件执行。"}
            </span>
          </div>
          {!forceAdjustmentPanel ? (
            <button
              className="text-button"
              type="button"
              aria-expanded={adjustmentPanelOpen}
              aria-controls={adjustmentPanelId}
              onClick={() => setAdjustmentsOpen((value) => !value)}
            >
              调整今天
            </button>
          ) : null}
        </section>
      ) : null}

      <SurfaceCard className="today-plan-card" aria-label="今日计划">
        <SectionHeading
          eyebrow="今日计划"
          title={planTitle}
          aside={
            tasks.length > 0 ? (
              <span className="count-badge">
                {completedCount} / {tasks.length}
              </span>
            ) : null
          }
        />
        {missing ? (
          <p className="empty-state-copy">
            还没有训练计划。完成设置后，今天的安排会显示在这里。
          </p>
        ) : null}
        {notStarted ? (
          <p className="empty-state-copy">
            计划已就绪。开始前可以先记录一次基线反馈。
          </p>
        ) : null}
        {!missing && !notStarted && tasks.length === 0 ? (
          <p className="empty-state-copy">
            {baselineDay
              ? "今天是恢复/基线日；可先记录一次基线反馈。"
              : "按计划恢复即可；如果有突发反应，仍可以随时提交反馈。"}
          </p>
        ) : null}
        {tasks.length > 0 ? (
          <div className="task-list">
            {tasks.map((task) => {
              const taskRecords = confirmedRecords.filter(
                (record) => taskIdForRecord(record, tasks) === task.id,
              );
              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  records={taskRecords}
                  onUpdated={onTaskUpdated}
                  localDate={localDate}
                  planVersion={planVersion}
                />
              );
            })}
          </div>
        ) : null}
        <TodaySyncControl
          trackerKey="knee-rehab"
          onCompleted={onLatestSyncCompleted}
        />
        {!adjustmentException ? (
          <div className="today-adjustment-entry">
            <button
              className="text-button"
              type="button"
              aria-expanded={adjustmentPanelOpen}
              aria-controls={adjustmentPanelId}
              onClick={() => setAdjustmentsOpen((value) => !value)}
            >
              调整今天
            </button>
          </div>
        ) : null}
      </SurfaceCard>

      {adjustmentPanelOpen ? (
        <div id={adjustmentPanelId} className="today-adjustment-panel">
          <fieldset
            className="offline-write-boundary"
            disabled={writesDisabled}
          >
            <ExecutionPauseCard
              trackerKey="knee-rehab"
              execution={execution}
              onChanged={onExecutionChanged}
            />
          </fieldset>
          <fieldset
            className="offline-write-boundary"
            disabled={writesDisabled}
          >
            <ExecutionContextCard
              trackerKey="knee-rehab"
              localDate={localDate}
              planVersion={planVersion}
              execution={execution}
              onChanged={onExecutionChanged}
            />
          </fieldset>
        </div>
      ) : null}

      {pendingRecords.length > 0 ? (
        <SurfaceCard className="pending-sources-card" aria-label="待处理来源">
          <SectionHeading
            eyebrow="活动与训练来源"
            title={`${pendingRecords.length} 条需要确认`}
            aside={
              <StatusPill tone="attention" icon="!">
                待处理
              </StatusPill>
            }
          />
          <ExternalTrainingSection
            trackerKey="knee-rehab"
            records={pendingRecords}
            tasks={tasks}
            heading="需要确认的来源记录"
            onUpdated={handleExternalTrainingUpdated}
            onConflict={onExternalTrainingConflict}
            readOnly={writesDisabled}
          />
        </SurfaceCard>
      ) : null}

      {currentSafety && currentSafety !== "green" ? (
        <SurfaceCard className="feedback-card" aria-label="身体反馈">
          <SectionHeading
            eyebrow="身体反馈"
            title={
              feedbackCount > 0
                ? `今天已记录 ${feedbackCount} 次`
                : "今天还没有记录"
            }
            aside={
              <StatusPill tone={safetyTone(currentSafety)} icon="!">
                {safetyLabel(currentSafety)}
              </StatusPill>
            }
          />
          <p className={`safety-message ${currentSafety}`}>
            {safetyGuidance(currentSafety)}
          </p>
          <div className="button-row">
            <Link className="primary-button" href="/feedback" scroll={false}>
              {feedbackCount > 0 ? "再次反馈" : "记录身体反馈"}
            </Link>
            <Link
              className="secondary-button"
              href={`/plan/conversation?date=${encodeURIComponent(localDate)}`}
            >
              告诉康复助手
            </Link>
          </div>
        </SurfaceCard>
      ) : (
        <section className="feedback-compact" aria-label="身体反馈">
          <div className="feedback-compact-copy">
            <strong>身体反馈</strong>
            <span>
              {feedbackCount > 0
                ? `今天已记录 ${feedbackCount} 次`
                : "今天还没有记录"}
            </span>
          </div>
          <div className="feedback-compact-actions">
            <Link className="primary-button" href="/feedback" scroll={false}>
              {feedbackCount > 0 ? "再次反馈" : "记录身体反馈"}
            </Link>
            <Link
              className="text-button"
              href={`/plan/conversation?date=${encodeURIComponent(localDate)}`}
            >
              告诉康复助手
            </Link>
          </div>
        </section>
      )}

      {initialDashboard.recoveryReference ? (
        <RecoveryReferenceCard reference={initialDashboard.recoveryReference} />
      ) : null}
    </main>
  );
}
