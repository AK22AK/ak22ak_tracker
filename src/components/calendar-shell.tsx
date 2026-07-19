import { calendarMonthCells, shiftMonth } from "@/domain/calendar";
import type {
  CalendarDaySummary,
  DashboardFeedback,
  DashboardTask,
  TodayDashboard,
} from "@/server/dashboard";

import { SignOutButton } from "./sign-out-button";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const timingLabels: Record<DashboardFeedback["timing"], string> = {
  morning: "晨间／训练前",
  post_training: "训练后",
  next_day: "次日反应",
  incident: "突发情况",
};
const safetyLabels = { green: "绿灯", yellow: "黄灯", red: "红灯" } as const;
const taskStatusLabels: Record<DashboardTask["status"], string> = {
  planned: "待完成",
  completed: "已完成",
  skipped: "已跳过",
};

function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-");
  return `${year} 年 ${Number(monthNumber)} 月`;
}

function formatSelectedDate(localDate: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${localDate}T00:00:00+08:00`));
}

function valueText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join("；");
  }
  return null;
}

function CalendarPrescription({ task }: { task: DashboardTask }) {
  const exercises = Array.isArray(task.prescription.exercises)
    ? task.prescription.exercises.filter(
        (item): item is { name: string; dose: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).name === "string" &&
          typeof (item as Record<string, unknown>).dose === "string",
      )
    : [];
  const fields = [
    ["warmup", "热身"],
    ["effort", "强度"],
    ["main", "主训练"],
    ["target", "目标"],
    ["cooldown", "结束"],
    ["gate", "执行条件"],
  ] as const;

  return (
    <div className="calendar-prescription">
      {fields.map(([key, label]) => {
        const text = valueText(task.prescription[key]);
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
              <span>{exercise.name}</span>
              <strong>{exercise.dose}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActualRecord({ task }: { task: DashboardTask }) {
  if (!task.actual && !task.subjectiveNote) {
    return <p className="calendar-empty-record">尚未填写实际训练数据。</p>;
  }

  return (
    <div className="calendar-actual-record">
      {task.actual?.kind === "exercise_list" && (
        <ul>
          {task.actual.exercises.map((exercise) => (
            <li key={exercise.name}>
              <span>
                {exercise.completed ? "✓" : "○"} {exercise.name}
              </span>
              <strong>{exercise.actual || "未填写组次"}</strong>
            </li>
          ))}
        </ul>
      )}
      {task.actual?.kind === "endurance" && (
        <div className="calendar-actual-metrics">
          <span>时长：{task.actual.durationMinutes ?? "—"} 分钟</span>
          <span>距离：{task.actual.distanceKm ?? "—"} km</span>
          {task.actual.summary && <p>{task.actual.summary}</p>}
        </div>
      )}
      {task.actual?.kind === "general" && task.actual.summary && (
        <p>{task.actual.summary}</p>
      )}
      {task.subjectiveNote && (
        <p className="calendar-subjective">感受：{task.subjectiveNote}</p>
      )}
    </div>
  );
}

function dayClass(
  date: string,
  summary: CalendarDaySummary | undefined,
  selectedDate: string,
  today: string,
) {
  return [
    "calendar-day",
    date === selectedDate ? "selected" : "",
    date === today ? "today" : "",
    summary?.completedCount === summary?.taskCount && summary?.taskCount
      ? "all-completed"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function CalendarShell({
  month,
  today,
  selectedDate,
  days,
  dashboard,
  detailLoading,
  detailError,
  onSelectDate,
  onSelectMonth,
}: {
  month: string;
  today: string;
  selectedDate: string;
  days: CalendarDaySummary[];
  dashboard: TodayDashboard | null;
  detailLoading: boolean;
  detailError: boolean;
  onSelectDate: (date: string) => void;
  onSelectMonth: (month: string) => void;
}) {
  const summaries = new Map(days.map((day) => [day.date, day]));
  const cells = calendarMonthCells(month);
  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <main className="app-shell calendar-shell">
      <header className="calendar-topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>训练日历</h1>
        </div>
        <div className="calendar-topbar-actions">
          <button
            className="today-link"
            type="button"
            onClick={() => onSelectDate(today)}
          >
            回到今天
          </button>
          <SignOutButton />
        </div>
      </header>

      <section className="calendar-card" aria-label={formatMonth(month)}>
        <div className="month-switcher">
          <button
            type="button"
            onClick={() => onSelectMonth(previousMonth)}
            aria-label="上个月"
          >
            ‹
          </button>
          <h2>{formatMonth(month)}</h2>
          <button
            type="button"
            onClick={() => onSelectMonth(nextMonth)}
            aria-label="下个月"
          >
            ›
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((date, index) => {
            if (!date)
              return (
                <span className="calendar-day empty" key={`empty-${index}`} />
              );
            const summary = summaries.get(date);
            return (
              <button
                type="button"
                key={date}
                className={dayClass(date, summary, selectedDate, today)}
                onClick={() => onSelectDate(date)}
                aria-label={`${date}，${summary?.taskCount ?? 0} 项训练，${summary?.feedbackCount ?? 0} 次反馈`}
              >
                <time dateTime={date}>{Number(date.slice(-2))}</time>
                <span className="calendar-markers">
                  {(summary?.taskCount ?? 0) > 0 && (
                    <span className="task-marker">
                      {summary?.completedCount}/{summary?.taskCount}
                    </span>
                  )}
                  {(summary?.feedbackCount ?? 0) > 0 && (
                    <span className="feedback-marker" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <p className="calendar-legend">
          任务数字为“完成／计划”，橙点表示当天有症状反馈。
        </p>
      </section>

      <section
        className="date-detail-card"
        aria-labelledby="selected-date-title"
      >
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">选中日期</p>
            <h2 id="selected-date-title">{formatSelectedDate(selectedDate)}</h2>
          </div>
          <span className="date-plan-version">
            {dashboard?.planVersion
              ? `计划 v${dashboard.planVersion}`
              : "无计划"}
          </span>
        </div>

        {detailLoading && (
          <div className="calendar-detail-loading" role="status">
            正在加载当天详情…
          </div>
        )}
        {detailError && !detailLoading && (
          <div className="calendar-no-data" role="alert">
            当天详情加载失败，请稍后重试。
          </div>
        )}
        {dashboard && !detailLoading && !detailError && (
          <>
            <div className="calendar-task-list">
              {dashboard.tasks.map((task) => (
                <article
                  className={`calendar-task ${task.status}`}
                  key={task.id}
                >
                  <div className="calendar-task-heading">
                    <strong>{task.title}</strong>
                    <span>{taskStatusLabels[task.status]}</span>
                  </div>
                  {task.description && <p>{task.description}</p>}
                  <details>
                    <summary>查看当天计划</summary>
                    <CalendarPrescription task={task} />
                  </details>
                  {(task.status !== "planned" ||
                    task.actual ||
                    task.subjectiveNote) && <ActualRecord task={task} />}
                </article>
              ))}
              {dashboard.tasks.length === 0 && (
                <p className="calendar-no-data">当天没有计划训练。</p>
              )}
            </div>

            <div className="calendar-feedback-list">
              <h3>症状反馈</h3>
              {dashboard.feedbacks.map((feedback) => (
                <article
                  className={`calendar-feedback ${feedback.safetyLevel}`}
                  key={feedback.id}
                >
                  <div>
                    <strong>{timingLabels[feedback.timing]}</strong>
                    <span>{safetyLabels[feedback.safetyLevel]}</span>
                  </div>
                  <p>
                    左膝 {feedback.leftPain}/10 · 右膝 {feedback.rightPain}/10 ·
                    肿胀 {feedback.swelling}
                  </p>
                  {feedback.note && <p>{feedback.note}</p>}
                </article>
              ))}
              {dashboard.feedbacks.length === 0 && (
                <p className="calendar-no-data">当天没有症状反馈。</p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
