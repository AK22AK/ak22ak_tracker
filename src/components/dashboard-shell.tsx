"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";

import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type {
  ExternalRecordAssociation,
  ExternalTrainingRecord,
} from "@/domain/external-training";
import type { TaskActual } from "@/domain/schemas";
import type { DashboardTask, TodayDashboard } from "@/server/dashboard";
import type { ExecutionContextToday } from "@/domain/execution-context";

import { SignOutButton } from "./sign-out-button";
import { ExternalTrainingSection } from "./external-training-section";
import { ExecutionContextCard } from "./execution-context-card";
import {
  SectionHeading,
  StatusPill,
  SurfaceCard,
  type StatusTone,
} from "./ui/primitives";

function subscribeToNetworkState(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

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
  tasks,
  onUpdated,
  onExternalTrainingUpdated,
}: {
  task: DashboardTask;
  records: ExternalTrainingRecord[];
  tasks: DashboardTask[];
  onUpdated: (task: DashboardTask) => void;
  onExternalTrainingUpdated: (
    recordId: string,
    association: ExternalRecordAssociation,
  ) => void;
}) {
  const [note, setNote] = useState(task.subjectiveNote ?? "");
  const [actual, setActual] = useState(() => initialTaskActual(task));
  const [expanded, setExpanded] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const pendingCommand = useRef<PendingClientCommand | null>(null);

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
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...command.metadata,
        }),
      });
      if (!response.ok) throw new Error("task_update_failed");
      pendingCommand.current = null;
      onUpdated({
        ...task,
        status,
        actual,
        subjectiveNote: nextNote || null,
      });
      setSaveMessage(status === "completed" ? "已保存并完成" : "记录已保存");
    } catch {
      setSaveFailed(true);
      setSaveMessage("保存失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  }

  const status = taskStatusPresentation[task.status];
  const detailsId = `task-details-${task.id}`;

  return (
    <article
      className={`task-card ${task.status}`}
      data-status={task.status}
      aria-label={task.title}
    >
      <div className="task-card-summary">
        <label className="task-check" title={`标记${task.title}完成`}>
          <input
            type="checkbox"
            aria-label={task.title}
            checked={task.status === "completed"}
            disabled={saving}
            onChange={(event) =>
              save(event.target.checked ? "completed" : "planned")
            }
          />
          <span className="task-check-box" aria-hidden="true" />
        </label>
        <button
          className="task-summary-button"
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? "收起" : "展开"} ${task.title}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="task-summary-copy">
            <strong>{task.title}</strong>
            <span>{taskDoseSummary(task)}</span>
          </span>
          <span className="task-expand-icon" aria-hidden="true">
            {expanded ? "⌃" : "⌄"}
          </span>
        </button>
        <StatusPill tone={status.tone} icon={status.icon}>
          {status.label}
        </StatusPill>
      </div>
      {expanded ? (
        <div className="task-card-details" id={detailsId}>
          <div className="task-detail-block">
            <h3>计划处方</h3>
            {task.description ? (
              <p className="task-description">{task.description}</p>
            ) : null}
            <Prescription prescription={task.prescription} />
          </div>

          {records.length > 0 ? (
            <ExternalTrainingSection
              trackerKey="knee-rehab"
              records={records}
              tasks={tasks}
              heading="已同步训练"
              onUpdated={onExternalTrainingUpdated}
            />
          ) : null}

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
                              disabled={saving}
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
                            disabled={saving}
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
                            disabled={saving}
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
                            disabled={saving}
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
                          disabled={saving}
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
                        disabled={saving}
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
                  disabled={saving}
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
              disabled={saving}
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

function executionModeLabel(execution: ExecutionContextToday) {
  const context = execution.context;
  if (!context) return "正常模式";
  if (context.status === "upcoming") {
    return context.kind === "travel"
      ? "正常模式 · 已安排出差"
      : "正常模式 · 已安排器械受限";
  }
  return context.kind === "travel" ? "出差维持模式" : "器械受限模式";
}

export function DashboardShell({
  today,
  localDate,
  planVersion,
  initialDashboard,
  execution,
  onRefresh,
  onExecutionChanged,
  onTaskUpdated,
  onExternalTrainingUpdated,
}: {
  today: string;
  localDate: string;
  planVersion: number | null;
  initialDashboard: TodayDashboard;
  execution: ExecutionContextToday;
  onRefresh: () => Promise<unknown>;
  onExecutionChanged: () => Promise<unknown>;
  onTaskUpdated: (task: DashboardTask) => void;
  onExternalTrainingUpdated: (
    recordId: string,
    association: ExternalRecordAssociation,
  ) => void;
}) {
  const online = useSyncExternalStore(
    subscribeToNetworkState,
    () => navigator.onLine,
    () => true,
  );
  const [refreshing, setRefreshing] = useState(false);

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
  const latestSafety = initialDashboard.feedbacks.at(-1)?.safetyLevel ?? null;
  const currentSafety = latestSafety;
  const externalRecords = initialDashboard.externalTrainingRecords;
  const pendingRecords = externalRecords.filter(
    (record) =>
      !record.association ||
      record.association.status === "suggested" ||
      record.association.needsReview,
  );
  const unassignedRecords = externalRecords.filter(
    (record) => taskIdForRecord(record, tasks) === null,
  );

  const planTitle = missing
    ? "等待导入私人计划"
    : notStarted
      ? `计划将于 ${formatStartDate(initialDashboard.startDate)}开始`
      : tasks.length === 0
        ? "今天没有安排训练"
        : remainingCount > 0
          ? `今天还剩 ${remainingCount} 项`
          : "今天的任务已处理";

  return (
    <main className="app-shell today-page">
      <header className="today-header">
        <div className="today-title-row">
          <div>
            <p className="eyebrow">AK Tracker</p>
            <h1>{today}</h1>
          </div>
          <button
            className="refresh-button"
            type="button"
            aria-label="刷新今日数据"
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
            {refreshing ? "刷新中" : "刷新"}
          </button>
        </div>
        <div className="today-meta-row">
          <div className="today-meta-copy">
            <span>
              {initialDashboard.planVersion
                ? `康复计划 v${initialDashboard.planVersion}`
                : "康复计划待设置"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{executionModeLabel(execution)}</span>
          </div>
          <StatusPill
            tone={online ? "neutral" : "attention"}
            icon={online ? "●" : "!"}
          >
            {online ? "当前在线" : "当前离线"}
          </StatusPill>
          <SignOutButton />
        </div>
      </header>

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

      <ExecutionContextCard
        trackerKey="knee-rehab"
        localDate={localDate}
        planVersion={planVersion}
        execution={execution}
        onChanged={onExecutionChanged}
      />

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
            认证和数据库已连接，等待导入第一份私人计划。
          </p>
        ) : null}
        {notStarted ? (
          <p className="empty-state-copy">
            计划 v{initialDashboard.planVersion}{" "}
            已就绪。开始前可以先记录一次基线反馈。
          </p>
        ) : null}
        {!missing && !notStarted && tasks.length === 0 ? (
          <p className="empty-state-copy">
            按计划恢复即可；如果有突发反应，仍可以随时提交反馈。
          </p>
        ) : null}
        {tasks.length > 0 ? (
          <div className="task-list">
            {tasks.map((task) => {
              const taskRecords = externalRecords.filter(
                (record) => taskIdForRecord(record, tasks) === task.id,
              );
              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  records={taskRecords}
                  tasks={tasks}
                  onUpdated={onTaskUpdated}
                  onExternalTrainingUpdated={onExternalTrainingUpdated}
                />
              );
            })}
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard className="feedback-card" aria-label="身体反馈">
        <SectionHeading
          eyebrow="身体反馈"
          title={
            feedbackCount > 0
              ? `今天已记录 ${feedbackCount} 次`
              : "今天还没有记录"
          }
          aside={
            currentSafety ? (
              <StatusPill
                tone={safetyTone(currentSafety)}
                icon={currentSafety === "green" ? "✓" : "!"}
              >
                {safetyLabel(currentSafety)}
              </StatusPill>
            ) : (
              <StatusPill tone="attention" icon="!">
                待反馈
              </StatusPill>
            )
          }
        />
        {currentSafety ? (
          <p className={`safety-message ${currentSafety}`}>
            {safetyGuidance(currentSafety)}
          </p>
        ) : null}
        <p className="feedback-supporting-copy">
          可提交训练前后、次日反应或突发情况；每天至少记录一次。
        </p>
        <Link className="secondary-button" href="/feedback" scroll={false}>
          {feedbackCount > 0 ? "再次反馈" : "添加反馈"}
        </Link>
      </SurfaceCard>

      <SurfaceCard className="pending-sources-card" aria-label="待处理来源">
        <SectionHeading
          eyebrow="训练来源"
          title={
            pendingRecords.length > 0
              ? `${pendingRecords.length} 条需要确认`
              : "暂无待处理来源"
          }
          aside={
            pendingRecords.length > 0 ? (
              <StatusPill tone="attention" icon="!">
                待处理
              </StatusPill>
            ) : null
          }
        />
        {pendingRecords.length > 0 ? (
          <div className="pending-source-list">
            {pendingRecords.map((record) => (
              <div key={record.id}>
                <StatusPill tone="brand">训记</StatusPill>
                <span>{record.details.title}</span>
                <small>
                  {record.association?.needsReview
                    ? "来源已更新，需复核"
                    : record.suggestion
                      ? "已有匹配建议，请展开任务确认"
                      : "尚未匹配任务"}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state-copy">
            同步记录和关联建议会出现在这里；来源关联不会自动完成任务。
          </p>
        )}
        {unassignedRecords.length > 0 ? (
          <ExternalTrainingSection
            trackerKey="knee-rehab"
            records={unassignedRecords}
            tasks={tasks}
            heading="未归入任务的训练"
            onUpdated={onExternalTrainingUpdated}
          />
        ) : null}
      </SurfaceCard>

      <footer className="today-technical-status" aria-label="应用状态">
        <span>{online ? "网络可用" : "当前离线"}</span>
        <span aria-hidden="true">·</span>
        <div>外部集成状态请在“设置”查看</div>
      </footer>
    </main>
  );
}
