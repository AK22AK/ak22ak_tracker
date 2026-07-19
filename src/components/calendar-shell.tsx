import { calendarMonthCells, shiftMonth } from "@/domain/calendar";
import type {
  CalendarDaySummary,
  DashboardFeedback,
  DashboardTask,
  TodayDashboard,
} from "@/server/dashboard";
import type { ExternalRecordAssociation } from "@/domain/external-training";

import { SignOutButton } from "./sign-out-button";
import { ExternalTrainingSection } from "./external-training-section";

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

function selectedDateContext(localDate: string, today: string) {
  if (localDate === today) return "今天";
  return localDate < today ? "历史记录" : "未来计划";
}

function dayTaskLabel(
  summary: CalendarDaySummary | undefined,
  date: string,
  today: string,
  monthLoading: boolean,
  monthError: boolean,
) {
  if (!summary && monthLoading) return "月摘要加载中";
  if (!summary && monthError) return "月摘要暂时不可用";
  if (!summary?.taskCount) return "无任务";
  if (summary.completedCount === summary.taskCount) return "全部完成";
  if (summary.skippedCount === summary.taskCount) return "已跳过";
  if (date > today) return `${summary.taskCount} 项计划`;
  return `${summary.completedCount}/${summary.taskCount} 项完成`;
}

function dayAccessibleLabel(
  date: string,
  summary: CalendarDaySummary | undefined,
  selectedDate: string,
  today: string,
  monthLoading: boolean,
  monthError: boolean,
) {
  const parts = [date];
  if (date === selectedDate) parts.push("已选中");
  parts.push(date === today ? "今天" : date < today ? "历史" : "未来");
  parts.push(dayTaskLabel(summary, date, today, monthLoading, monthError));
  if (summary?.feedbackCount) {
    parts.push(`${summary.feedbackCount} 次反馈`);
  }
  if (summary?.paused) parts.push("暂停日");
  return parts.join("，");
}

function dayVisualTaskLabel(
  summary: CalendarDaySummary | undefined,
  date: string,
  today: string,
) {
  if (!summary?.taskCount) return null;
  if (summary.completedCount === summary.taskCount) return "✓";
  if (summary.skippedCount === summary.taskCount) return "跳";
  if (date > today) return `${summary.taskCount}项`;
  return `${summary.completedCount}/${summary.taskCount}`;
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

function CalendarDayUnavailable({ dashboard }: { dashboard: TodayDashboard }) {
  if (dashboard.state === "not_started") {
    return (
      <div className="calendar-detail-state empty">
        <strong>计划尚未开始</strong>
        <p>
          当前计划从 {dashboard.startDate ?? "稍后"} 开始，可先查看其他日期。
        </p>
      </div>
    );
  }

  return (
    <div className="calendar-detail-state empty">
      <strong>当天没有生效计划</strong>
      <p>可查看相邻日期，或在设置中确认当前计划版本。</p>
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
    date > today ? "future" : "past",
    summary?.taskCount ? "has-tasks" : "",
    summary?.feedbackCount ? "has-feedback" : "",
    summary?.paused ? "paused" : "",
    summary?.completedCount === summary?.taskCount && summary?.taskCount
      ? "all-completed"
      : "",
    summary?.skippedCount === summary?.taskCount && summary?.taskCount
      ? "all-skipped"
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
  monthLoading,
  monthError,
  dashboard,
  detailLoading,
  detailError,
  onRetryDetail,
  onRetryMonth,
  onSelectDate,
  onSelectMonth,
  onExternalTrainingUpdated,
}: {
  month: string;
  today: string;
  selectedDate: string;
  days: CalendarDaySummary[];
  monthLoading: boolean;
  monthError: boolean;
  dashboard: TodayDashboard | null;
  detailLoading: boolean;
  detailError: boolean;
  onRetryDetail: () => void;
  onRetryMonth: () => void;
  onSelectDate: (date: string) => void;
  onSelectMonth: (month: string) => void;
  onExternalTrainingUpdated: (
    recordId: string,
    association: ExternalRecordAssociation,
  ) => void;
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

      <section
        className="calendar-card"
        aria-label={formatMonth(month)}
        aria-busy={monthLoading}
      >
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
        {monthLoading && (
          <p className="calendar-month-status" role="status">
            正在更新月摘要…
          </p>
        )}
        {monthError && !monthLoading && (
          <div className="calendar-month-status error" role="alert">
            <span>月摘要暂时不可用</span>
            <button type="button" onClick={onRetryMonth}>
              重试
            </button>
          </div>
        )}
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
            const visualTaskLabel = dayVisualTaskLabel(summary, date, today);
            return (
              <button
                type="button"
                key={date}
                className={dayClass(date, summary, selectedDate, today)}
                onClick={() => onSelectDate(date)}
                aria-current={date === today ? "date" : undefined}
                aria-pressed={date === selectedDate}
                aria-label={dayAccessibleLabel(
                  date,
                  summary,
                  selectedDate,
                  today,
                  monthLoading,
                  monthError,
                )}
              >
                <time dateTime={date}>
                  {Number(date.slice(-2))}
                  {date === today && (
                    <span className="calendar-today-mark" aria-hidden="true">
                      今
                    </span>
                  )}
                </time>
                <span className="calendar-markers">
                  {visualTaskLabel && (
                    <span className="task-marker" aria-hidden="true">
                      {visualTaskLabel}
                    </span>
                  )}
                  {(summary?.feedbackCount ?? 0) > 0 && (
                    <span className="feedback-marker" aria-hidden="true">
                      ◆
                    </span>
                  )}
                  {summary?.paused && (
                    <span className="pause-marker" aria-hidden="true">
                      暂
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="calendar-legend" aria-label="日历标记说明">
          <span>
            <i className="legend-symbol completed" aria-hidden="true">
              ✓
            </i>
            全部完成
          </span>
          <span>
            <i className="legend-symbol skipped" aria-hidden="true">
              跳
            </i>
            已跳过
          </span>
          <span>
            <i className="legend-symbol feedback" aria-hidden="true">
              ◆
            </i>
            有反馈
          </span>
          <span>
            <i className="legend-symbol paused" aria-hidden="true">
              暂
            </i>
            暂停日
          </span>
        </div>
      </section>

      <section
        className="date-detail-card"
        aria-labelledby="selected-date-title"
      >
        <div className="section-heading compact calendar-detail-heading">
          <div>
            <p className="eyebrow">
              {selectedDateContext(selectedDate, today)}
            </p>
            <h2 id="selected-date-title">{formatSelectedDate(selectedDate)}</h2>
          </div>
          <span className="status-pill date-plan-version" data-tone="brand">
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
          <div className="calendar-detail-state error" role="alert">
            <strong>当天详情暂时没有加载成功</strong>
            <p>月历仍可继续使用，你可以稍后再试。</p>
            <button type="button" onClick={onRetryDetail}>
              重新加载当天详情
            </button>
          </div>
        )}
        {dashboard &&
          !detailLoading &&
          !detailError &&
          (dashboard.state !== "ready" ? (
            <CalendarDayUnavailable dashboard={dashboard} />
          ) : (
            <>
              {summaries.get(selectedDate)?.paused ? (
                <div className="calendar-pause-notice" role="status">
                  当天为暂停日，基础计划保留，任务状态没有自动改变。
                </div>
              ) : null}
              <div className="calendar-day-overview" aria-label="当天概览">
                <span>
                  <strong>{dashboard.tasks.length}</strong> 项任务
                </span>
                <span>
                  <strong>{dashboard.feedbackCount}</strong> 次反馈
                </span>
                <span>
                  <strong>{dashboard.externalTrainingRecords.length}</strong>{" "}
                  条来源
                </span>
              </div>
              <ExternalTrainingSection
                trackerKey="knee-rehab"
                records={dashboard.externalTrainingRecords}
                tasks={dashboard.tasks}
                onUpdated={onExternalTrainingUpdated}
              />
              <div className="calendar-task-list">
                <div className="calendar-subsection-heading">
                  <div>
                    <p className="eyebrow">计划与执行</p>
                    <h3>当天任务</h3>
                  </div>
                  <span className="count-badge">{dashboard.tasks.length}</span>
                </div>
                {dashboard.tasks.map((task) => (
                  <article
                    className={`calendar-task ${task.status}`}
                    key={task.id}
                  >
                    <div className="calendar-task-heading">
                      <strong>{task.title}</strong>
                      <span
                        className="status-pill"
                        data-tone={
                          task.status === "completed"
                            ? "success"
                            : task.status === "skipped"
                              ? undefined
                              : "brand"
                        }
                      >
                        {taskStatusLabels[task.status]}
                      </span>
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
                  <div className="calendar-detail-state empty compact">
                    <strong>当天没有计划任务</strong>
                    <p>仍可查看同步训练来源和身体反馈。</p>
                  </div>
                )}
              </div>

              <div className="calendar-feedback-list">
                <div className="calendar-subsection-heading">
                  <div>
                    <p className="eyebrow">身体状态</p>
                    <h3>症状反馈</h3>
                  </div>
                  <span className="count-badge">{dashboard.feedbackCount}</span>
                </div>
                {dashboard.feedbacks.map((feedback) => (
                  <article
                    className={`calendar-feedback ${feedback.safetyLevel}`}
                    key={feedback.id}
                  >
                    <div>
                      <strong>{timingLabels[feedback.timing]}</strong>
                      <span
                        className="status-pill"
                        data-tone={
                          feedback.safetyLevel === "green"
                            ? "success"
                            : feedback.safetyLevel === "yellow"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {feedback.safetyLevel === "green"
                          ? "✓"
                          : feedback.safetyLevel === "yellow"
                            ? "!"
                            : "×"}{" "}
                        {safetyLabels[feedback.safetyLevel]}
                      </span>
                    </div>
                    <p>
                      左膝 {feedback.leftPain}/10 · 右膝 {feedback.rightPain}/10
                      · 肿胀 {feedback.swelling}
                    </p>
                    {feedback.note && <p>{feedback.note}</p>}
                  </article>
                ))}
                {dashboard.feedbacks.length === 0 && (
                  <p className="calendar-no-data">当天没有症状反馈。</p>
                )}
              </div>
            </>
          ))}
      </section>
    </main>
  );
}
