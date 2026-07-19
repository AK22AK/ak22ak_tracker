"use client";

import { type FormEvent, useRef, useState, useSyncExternalStore } from "react";

import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type { TaskActual } from "@/domain/schemas";
import type { DashboardTask, TodayDashboard } from "@/server/dashboard";

import { BottomNav } from "./bottom-nav";
import { SignOutButton } from "./sign-out-button";

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
  onUpdated,
}: {
  task: DashboardTask;
  onUpdated: (task: DashboardTask) => void;
}) {
  const [note, setNote] = useState(task.subjectiveNote ?? "");
  const [actual, setActual] = useState(() => initialTaskActual(task));
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

  return (
    <article className={`task-card ${task.status}`}>
      <div className="task-title-row">
        <label className="task-check">
          <input
            type="checkbox"
            checked={task.status === "completed"}
            disabled={saving}
            onChange={(event) =>
              save(event.target.checked ? "completed" : "planned")
            }
          />
          <span aria-hidden="true" />
          <strong>{task.title}</strong>
        </label>
        {task.status === "completed" && <em>已完成</em>}
        {task.status === "skipped" && <em>已跳过</em>}
      </div>
      {task.description && (
        <p className="task-description">{task.description}</p>
      )}
      <details>
        <summary>查看计划内容</summary>
        <Prescription prescription={task.prescription} />
      </details>
      <div className="task-actual">
        <strong>实际完成情况</strong>
        {actual.kind === "exercise_list" && (
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
                        exercises: current.exercises.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, completed: event.target.checked }
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
                      exercises: current.exercises.map((item, itemIndex) =>
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
        )}
        {actual.kind === "endurance" && (
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
                      durationMinutes: nullableNumber(event.target.value),
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
        )}
        {actual.kind === "general" && (
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
        )}
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
      <div className="task-actions">
        <button
          type="button"
          disabled={saving}
          onClick={() => save(task.status)}
        >
          {saving ? "保存中…" : "保存训练记录"}
        </button>
        <button
          className="quiet"
          type="button"
          disabled={saving}
          onClick={() =>
            save(task.status === "skipped" ? "planned" : "skipped")
          }
        >
          {task.status === "skipped" ? "恢复为待完成" : "今天跳过"}
        </button>
      </div>
      {saveMessage && (
        <p className={`task-save-message ${saveFailed ? "error" : "success"}`}>
          {saveMessage}
        </p>
      )}
    </article>
  );
}

function CheckInForm({
  onSaved,
}: {
  onSaved: (safetyLevel: "green" | "yellow" | "red") => void;
}) {
  const [saving, setSaving] = useState(false);
  const pendingCommand = useRef<PendingClientCommand | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    try {
      const form = new FormData(formElement);
      const payload = {
        timing: form.get("timing"),
        leftPain: Number(form.get("leftPain")),
        rightPain: Number(form.get("rightPain")),
        swelling: form.get("swelling"),
        stiffness: form.get("stiffness") === "on",
        mechanicalSymptoms: form.get("mechanicalSymptoms") === "on",
        weightBearingIssue: form.get("weightBearingIssue") === "on",
        localizedBonePain: form.get("localizedBonePain") === "on",
        nightOrRestPain: form.get("nightOrRestPain") === "on",
        note: form.get("note"),
      };
      const command = createOrReuseClientCommand(
        pendingCommand.current,
        payload,
      );
      pendingCommand.current = command;
      const response = await fetch("/api/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...command.metadata,
        }),
      });
      if (!response.ok) throw new Error("check_in_failed");
      const result = (await response.json()) as {
        safetyLevel: "green" | "yellow" | "red";
      };
      pendingCommand.current = null;
      formElement.reset();
      onSaved(result.safetyLevel);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="check-in-form" onSubmit={submit}>
      <label>
        反馈时机
        <select name="timing" defaultValue="post_training">
          <option value="morning">晨间／训练前</option>
          <option value="post_training">训练后</option>
          <option value="next_day">次日反应</option>
          <option value="incident">突发情况</option>
        </select>
      </label>
      <div className="pain-grid">
        <label>
          左膝疼痛（0–10）
          <input
            name="leftPain"
            type="number"
            min="0"
            max="10"
            defaultValue="0"
            required
          />
        </label>
        <label>
          右膝疼痛（0–10）
          <input
            name="rightPain"
            type="number"
            min="0"
            max="10"
            defaultValue="0"
            required
          />
        </label>
      </div>
      <label>
        肿胀
        <select name="swelling" defaultValue="none">
          <option value="none">无</option>
          <option value="mild">轻度</option>
          <option value="obvious">明显</option>
        </select>
      </label>
      <fieldset>
        <legend>异常表现</legend>
        <label>
          <input name="stiffness" type="checkbox" /> 新增僵硬
        </label>
        <label>
          <input name="mechanicalSymptoms" type="checkbox" />{" "}
          卡锁、伸不直或打软腿
        </label>
        <label>
          <input name="weightBearingIssue" type="checkbox" /> 跛行或无法正常负重
        </label>
        <label>
          <input name="localizedBonePain" type="checkbox" /> 固定骨性位置疼痛
        </label>
        <label>
          <input name="nightOrRestPain" type="checkbox" /> 夜间或静息痛加重
        </label>
      </fieldset>
      <label>
        主观感受
        <textarea
          name="note"
          maxLength={2000}
          placeholder="可补充训练感受、触发动作、恢复情况等"
        />
      </label>
      <button type="submit" disabled={saving}>
        {saving ? "保存中…" : "提交反馈"}
      </button>
    </form>
  );
}

export function DashboardShell({
  today,
  initialDashboard,
}: {
  today: string;
  initialDashboard: TodayDashboard;
}) {
  const online = useSyncExternalStore(
    subscribeToNetworkState,
    () => navigator.onLine,
    () => true,
  );
  const [tasks, setTasks] = useState(initialDashboard.tasks);
  const [feedbackCount, setFeedbackCount] = useState(
    initialDashboard.feedbackCount,
  );
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSafety, setLastSafety] = useState<
    "green" | "yellow" | "red" | null
  >(null);
  const completedCount = tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const notStarted = initialDashboard.state === "not_started";
  const missing = initialDashboard.state === "missing";

  const planTitle = missing
    ? "等待导入私人计划"
    : notStarted
      ? `计划将于 ${formatStartDate(initialDashboard.startDate)}开始`
      : tasks.length > 0
        ? "今天的训练"
        : "今天没有强制训练";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>{today}</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="refresh-button"
            type="button"
            aria-label="刷新今日数据"
            title={online ? "刷新今日数据" : "联网后刷新"}
            disabled={!online || refreshing}
            onClick={() => {
              setRefreshing(true);
              window.location.reload();
            }}
          >
            <span aria-hidden="true">↻</span>
            {refreshing ? "刷新中" : "刷新"}
          </button>
          <div className={`network-pill ${online ? "online" : "offline"}`}>
            <span aria-hidden="true" />
            {online ? "已联网" : "当前离线"}
          </div>
          <SignOutButton />
        </div>
      </header>

      <section className="hero-card" aria-labelledby="today-plan-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow light">今日计划</p>
            <h2 id="today-plan-title">{planTitle}</h2>
          </div>
          <span className="count-badge">
            {completedCount} / {tasks.length}
          </span>
        </div>
        {missing && (
          <p className="hero-copy">
            认证和数据库已连接，等待导入第一份私人计划。
          </p>
        )}
        {notStarted && (
          <p className="hero-copy">
            计划 v{initialDashboard.planVersion}{" "}
            已就绪。开始前可以先记录一次基线反馈。
          </p>
        )}
        {!missing && !notStarted && tasks.length === 0 && (
          <p className="hero-copy">
            按计划恢复即可；如果有突发反应，仍可以随时提交反馈。
          </p>
        )}
        {tasks.length > 0 && (
          <div className="task-list">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdated={(updated) =>
                  setTasks((current) =>
                    current.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="feedback-card" aria-labelledby="feedback-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">每日反馈</p>
            <h2 id="feedback-title">
              {feedbackCount > 0
                ? `今天已记录 ${feedbackCount} 次`
                : "今天还没有记录"}
            </h2>
          </div>
          <span
            className={`status-dot ${feedbackCount > 0 ? "done" : ""}`}
            aria-label={feedbackCount > 0 ? "已反馈" : "待反馈"}
          />
        </div>
        {lastSafety && (
          <p className={`safety-message ${lastSafety}`}>
            {lastSafety === "green" &&
              "绿灯：当前反馈支持维持计划；升级仍需连续两次同级绿灯。"}
            {lastSafety === "yellow" &&
              "黄灯：今天不要升级，优先回到上一绿灯水平或减少最近增量。"}
            {lastSafety === "red" &&
              "红灯：停止相关诱发负荷；若未迅速恢复或反复出现，应联系专业人员。"}
          </p>
        )}
        {!feedbackOpen && (
          <p>可提交训练前后、次日反应或突发情况；每天至少记录一次。</p>
        )}
        <button
          type="button"
          onClick={() => setFeedbackOpen((value) => !value)}
        >
          {feedbackOpen
            ? "收起反馈"
            : feedbackCount > 0
              ? "再次反馈"
              : "添加反馈"}
        </button>
        {feedbackOpen && (
          <CheckInForm
            onSaved={(safetyLevel) => {
              setFeedbackCount((count) => count + 1);
              setLastSafety(safetyLevel);
              setFeedbackOpen(false);
            }}
          />
        )}
      </section>

      <section className="status-grid" aria-label="同步状态">
        <article>
          <span className="status-icon">G</span>
          <div>
            <strong>Garmin</strong>
            <p>等待配置</p>
          </div>
        </article>
        <article>
          <span className="status-icon">↗</span>
          <div>
            <strong>数据镜像</strong>
            <p>等待配置</p>
          </div>
        </article>
      </section>

      <BottomNav current="today" />
    </main>
  );
}
