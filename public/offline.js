(() => {
  "use strict";

  const DB_NAME = "ak22ak-tracker";
  const PLANNING_TIME_ZONE = "Asia/Shanghai";
  const protectedTarget = location.pathname.startsWith("/calendar")
    ? "/calendar"
    : "/";

  if (navigator.onLine) {
    location.replace(protectedTarget);
    return;
  }

  const snapshotContract = globalThis.AKTrackerOfflineContract;
  const content = document.querySelector("#offline-content");
  const pageTitle = document.querySelector("#page-title");
  const savedAtLabel = document.querySelector("#offline-saved-at");
  const tabButtons = Array.from(document.querySelectorAll("[data-view]"));
  const state = {
    identity: null,
    trackerKey: null,
    rows: [],
    view: location.pathname.startsWith("/calendar") ? "calendar" : "today",
    selectedDate: null,
    month: null,
  };

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  }

  function stringValue(value) {
    return typeof value === "string" ? value : null;
  }

  function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function isLocalDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function localDateNow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: PLANNING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function openExistingDatabase() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
      };
      request.onerror = () => resolve(null);
      request.onsuccess = () => resolve(request.result);
      request.onblocked = () => resolve(null);
    });
  }

  function validSnapshotRow(row, identity) {
    return Boolean(snapshotContract?.validSnapshotRow(row, identity));
  }

  async function readPrivateSnapshots() {
    const database = await openExistingDatabase();
    if (!database) return { identity: null, rows: [] };
    try {
      if (
        !database.objectStoreNames.contains("metadata") ||
        !database.objectStoreNames.contains("querySnapshots")
      ) {
        return { identity: null, rows: [] };
      }
      const metadata = database
        .transaction("metadata", "readonly")
        .objectStore("metadata");
      const activeIdentity = await requestResult(
        metadata.get("active-identity"),
      );
      const identity = stringValue(objectValue(activeIdentity)?.value);
      if (!identity || !/^\d+$/.test(identity)) {
        return { identity: null, rows: [] };
      }
      const snapshots = database
        .transaction("querySnapshots", "readonly")
        .objectStore("querySnapshots");
      const allRows = snapshots.indexNames.contains("githubUserId")
        ? await requestResult(snapshots.index("githubUserId").getAll(identity))
        : await requestResult(snapshots.getAll());
      return {
        identity,
        rows: Array.isArray(allRows)
          ? allRows.filter((row) => validSnapshotRow(row, identity))
          : [],
      };
    } catch {
      return { identity: null, rows: [] };
    } finally {
      database.close();
    }
  }

  function rowFor(kind, scope) {
    return (
      state.rows.find(
        (row) =>
          row.trackerKey === state.trackerKey &&
          row.kind === kind &&
          row.scope === scope,
      ) ?? null
    );
  }

  function chooseTrackerKey(rows, today) {
    const preferred = rows.find(
      (row) => row.kind === "today" && row.scope === today,
    );
    if (preferred) return preferred.trackerKey;
    return (
      [...rows].sort(
        (left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt),
      )[0]?.trackerKey ?? null
    );
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function replaceContent(...nodes) {
    content.replaceChildren(...nodes);
  }

  function badge(label, tone = "") {
    return element("span", `status-badge ${tone}`.trim(), label);
  }

  function formatSavedAt(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return "更新时间未知";
    return `最近更新：${new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed)}`;
  }

  function formatLocalDate(value) {
    if (!isLocalDate(value)) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: PLANNING_TIME_ZONE,
      month: "long",
      day: "numeric",
      weekday: "short",
    })
      .format(new Date(`${value}T12:00:00+08:00`))
      .replace("周", " · 周");
  }

  function safeTasks(day) {
    const tasks = objectValue(day)?.tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks
      .map((task) => {
        const value = objectValue(task);
        const title = stringValue(value?.title);
        const status = stringValue(value?.status);
        if (!title || !["planned", "completed", "skipped"].includes(status)) {
          return null;
        }
        return {
          title,
          status,
          prescription: objectValue(value.prescription) ?? {},
        };
      })
      .filter(Boolean);
  }

  function taskDose(task) {
    const prescription = task.prescription;
    for (const key of ["main", "target", "effort", "warmup"]) {
      const value = prescription[key];
      if (typeof value === "string" || typeof value === "number") {
        return String(value);
      }
    }
    const exercises = Array.isArray(prescription.exercises)
      ? prescription.exercises
      : [];
    const first = objectValue(exercises[0]);
    const name = stringValue(first?.name);
    const dose = stringValue(first?.dose);
    return [name, dose].filter(Boolean).join(" · ");
  }

  function renderTaskList(day) {
    const tasks = safeTasks(day);
    const list = element("div", "task-list");
    if (tasks.length === 0) {
      list.append(element("p", "", "这一天没有缓存到训练任务。"));
      return list;
    }
    const labels = {
      planned: ["待完成", ""],
      completed: ["已完成", "completed"],
      skipped: ["已跳过", "skipped"],
    };
    for (const task of tasks) {
      const article = element("article", "offline-task");
      const heading = element("div");
      heading.append(element("h3", "", task.title));
      heading.append(badge(labels[task.status][0], labels[task.status][1]));
      article.append(heading);
      const dose = taskDose(task);
      if (dose) article.append(element("p", "", dose));
      list.append(article);
    }
    return list;
  }

  function latestSafety(day) {
    const feedbacks = objectValue(day)?.feedbacks;
    if (!Array.isArray(feedbacks)) return null;
    const latest = objectValue(feedbacks.at(-1));
    const value = stringValue(latest?.safetyLevel);
    return ["green", "yellow", "red"].includes(value) ? value : null;
  }

  function renderFeedbackSummary(day) {
    const section = element("section", "surface-card");
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", "身体反馈"));
    const safety = latestSafety(day);
    const labels = { green: "绿灯", yellow: "黄灯", red: "红灯" };
    if (safety) heading.append(badge(labels[safety], safety));
    section.append(heading);
    const count = numberValue(objectValue(day)?.feedbackCount) ?? 0;
    section.append(
      element(
        "p",
        "",
        count > 0 ? `已缓存 ${count} 次反馈。` : "这一天没有缓存到反馈。",
      ),
    );
    return section;
  }

  function emptyState(title, message) {
    const section = element("section", "surface-card empty-state");
    section.append(element("strong", "", title));
    section.append(element("p", "", message));
    return section;
  }

  function validTodayData(row, date) {
    const data = objectValue(row?.data);
    return data && snapshotContract?.validTodayData(data, row?.trackerKey, date)
      ? data
      : null;
  }

  function validCalendarData(row, month) {
    const data = objectValue(row?.data);
    return data &&
      snapshotContract?.validCalendarData(data, row?.trackerKey, month)
      ? data
      : null;
  }

  function validDayData(row, date) {
    const data = objectValue(row?.data);
    return data && snapshotContract?.validDayData(data, row?.trackerKey, date)
      ? data
      : null;
  }

  function renderToday() {
    const today = localDateNow();
    state.selectedDate = today;
    pageTitle.textContent = formatLocalDate(today);
    const row = rowFor("today", today);
    const data = validTodayData(row, today);
    savedAtLabel.textContent =
      row && data ? formatSavedAt(row.savedAt) : "没有当前日期的有效缓存";
    if (!state.identity || !state.trackerKey || !data) {
      replaceContent(
        emptyState(
          "当前没有可用的今日缓存",
          "请在联网并完成身份验证后打开今日页，让设备保存一份只读快照。",
        ),
      );
      return;
    }

    const plan = objectValue(data.plan);
    const planSection = element("section", "surface-card");
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", "今日计划"));
    if (numberValue(plan?.version)) {
      heading.append(badge(`计划 v${plan.version}`));
    }
    planSection.append(heading, renderTaskList(data.day));
    replaceContent(planSection, renderFeedbackSummary(data.day));
  }

  function monthCells(month) {
    const start = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(start.valueOf())) return [];
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(next.valueOf() - 1).getUTCDate();
    const leading = (start.getUTCDay() + 6) % 7;
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from(
        { length: lastDay },
        (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
      ),
    ];
  }

  function shiftMonth(month, offset) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 7);
  }

  function renderSelectedDay(date) {
    const row = rowFor("day", date);
    const data = validDayData(row, date);
    const section = element("section", "surface-card day-detail-list");
    const heading = element("div", "section-heading");
    heading.append(element("h2", "", formatLocalDate(date)));
    if (row && data) heading.append(badge("离线详情"));
    section.append(heading);
    if (!data) {
      section.append(element("p", "", "这一天没有有效的本机详情缓存。"));
      return section;
    }
    section.append(renderTaskList(data.day), renderFeedbackSummary(data.day));
    return section;
  }

  function renderCalendar() {
    const today = localDateNow();
    state.month = state.month ?? today.slice(0, 7);
    state.selectedDate = state.selectedDate ?? today;
    pageTitle.textContent = "日历";
    const row = rowFor("calendar-month", state.month);
    const data = validCalendarData(row, state.month);
    savedAtLabel.textContent =
      row && data ? formatSavedAt(row.savedAt) : "当前月份没有有效缓存";

    const calendar = element("section", "surface-card");
    const toolbar = element("div", "month-toolbar");
    const previous = element("button", "", "‹");
    previous.type = "button";
    previous.setAttribute("aria-label", "上个月");
    previous.addEventListener("click", () => {
      state.month = shiftMonth(state.month, -1);
      state.selectedDate = `${state.month}-01`;
      renderCalendar();
    });
    const next = element("button", "", "›");
    next.type = "button";
    next.setAttribute("aria-label", "下个月");
    next.addEventListener("click", () => {
      state.month = shiftMonth(state.month, 1);
      state.selectedDate = `${state.month}-01`;
      renderCalendar();
    });
    toolbar.append(
      previous,
      element(
        "h2",
        "",
        `${state.month.slice(0, 4)} 年 ${Number(state.month.slice(5))} 月`,
      ),
      next,
    );
    calendar.append(toolbar);

    const weekdays = element("div", "weekdays");
    for (const day of ["一", "二", "三", "四", "五", "六", "日"]) {
      weekdays.append(element("span", "", day));
    }
    calendar.append(weekdays);

    const summaries = new Map();
    if (data) {
      for (const item of data.days) {
        const summary = objectValue(item);
        if (isLocalDate(summary?.date)) summaries.set(summary.date, summary);
      }
    }
    const grid = element("div", "calendar-grid");
    for (const date of monthCells(state.month)) {
      if (!date) {
        grid.append(element("span", "calendar-empty-cell"));
        continue;
      }
      const summary = summaries.get(date);
      const button = element(
        "button",
        `calendar-day${summary ? " has-data" : ""}${date === state.selectedDate ? " selected" : ""}`,
        Number(date.slice(-2)),
      );
      button.type = "button";
      button.setAttribute(
        "aria-label",
        `${date}${summary ? `，${numberValue(summary.taskCount) ?? 0} 项任务` : "，无缓存摘要"}`,
      );
      button.setAttribute(
        "aria-pressed",
        date === state.selectedDate ? "true" : "false",
      );
      button.addEventListener("click", () => {
        state.selectedDate = date;
        renderCalendar();
      });
      grid.append(button);
    }
    calendar.append(grid);
    replaceContent(calendar, renderSelectedDay(state.selectedDate));
  }

  function render() {
    for (const button of tabButtons) {
      const selected = button.dataset.view === state.view;
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (state.view === "calendar") renderCalendar();
    else renderToday();
  }

  async function initialize() {
    const today = localDateNow();
    const result = await readPrivateSnapshots();
    state.identity = result.identity;
    state.rows = result.rows;
    state.trackerKey = chooseTrackerKey(result.rows, today);
    state.month = today.slice(0, 7);
    state.selectedDate = today;
    render();
  }

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      history.replaceState(
        null,
        "",
        state.view === "calendar" ? "/calendar" : "/",
      );
      render();
      content.focus({ preventScroll: true });
    });
  }

  window.addEventListener("online", () => {
    location.replace(state.view === "calendar" ? "/calendar" : "/");
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .catch(() => undefined);
  }

  void initialize();
})();
