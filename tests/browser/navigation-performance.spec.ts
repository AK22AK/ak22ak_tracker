import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { aggregateEightWeekTrends } from "@/domain/trends";
import type { TodayDashboard } from "@/server/dashboard";

const baseURL = "http://127.0.0.1:4174";
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const nextLocalDate = (() => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
})();
const historyRangeFrom = (() => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 13);
  return date.toISOString().slice(0, 10);
})();
const historyRecordDate = (() => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
})();

const taskId = "019c0000-0000-7000-8000-000000000002";

const day = {
  state: "ready",
  trackerName: "Anonymous Tracker",
  startDate: "2026-07-01",
  planVersion: 1,
  tasks: [
    {
      id: taskId,
      title: "Anonymous task",
      description: "匿名模板说明",
      category: "general",
      prescription: {
        exercises: [{ name: "Anonymous movement", dose: "2 × 8" }],
      },
      status: "planned",
      actual: null,
      subjectiveNote: null,
    },
  ],
  feedbackCount: 0,
  feedbacks: [] as ReturnType<typeof anonymousFeedback>[],
  externalTrainingRecords: [
    {
      id: "019c0000-0000-7000-8000-000000000004",
      provider: "garmin",
      localDate,
      occurredAt: `${localDate}T02:00:00+08:00`,
      sourceVersion: 1,
      details: {
        kind: "activity",
        activityType: "running",
        startedAt: `${localDate}T02:00:00+08:00`,
        durationSeconds: 1_800,
        distanceMeters: 3_000,
        averagePaceSecondsPerKilometer: 360,
        averageHeartRateBpm: 120,
      },
      association: null,
      suggestion: null,
    },
  ],
};

function anonymousFeedback(safetyLevel: "green" | "yellow" | "red") {
  return {
    id: "019c0000-0000-7000-8000-000000000099",
    occurredAt: `${localDate}T08:00:00+08:00`,
    timing: "morning",
    leftPain: 0,
    rightPain: 0,
    swelling: "none",
    safetyLevel,
    note: "Anonymous feedback",
  };
}

const todayAggregate = {
  tracker: {
    key: "knee-rehab",
    name: "Anonymous Tracker",
    startedOn: "2026-07-01",
    planningTimeZone: "Asia/Shanghai",
  },
  targetDate: localDate,
  plan: {
    id: "019c0000-0000-7000-8000-000000000001",
    version: 1,
    effectiveFrom: "2026-07-01",
  },
  day,
  safetyPolicy: {
    schemaVersion: "1.0.0",
    policyId: "019c0000-0000-7000-8000-000000000003",
    trackerKey: "knee-rehab",
    version: 1,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: "import",
    rules: [
      {
        id: "anonymous-warning",
        outcome: "yellow",
        match: "all",
        conditions: [{ operator: "number_gte", field: "score", value: 999 }],
      },
    ],
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  execution: {
    context: null,
    day: null,
    alternatives: [],
    safety: { blocked: false, reason: null },
  },
};

const todayR9ChineseFixture = {
  ...todayAggregate,
  tracker: {
    ...todayAggregate.tracker,
    name: "膝盖康复计划",
  },
  day: {
    ...todayAggregate.day,
    trackerName: "膝盖康复计划",
    externalTrainingRecords: [],
    tasks: todayAggregate.day.tasks.map((task) => ({
      ...task,
      title: "上肢综合训练",
      description: "今天完成四个动作，按当前负荷记录实际完成情况。",
      prescription: {
        exercises: [
          { name: "坐姿划船", dose: "2 组 × 10 次" },
          { name: "墙面俯卧撑", dose: "2 组 × 8 次" },
          { name: "弹力带外旋", dose: "2 组 × 12 次" },
          { name: "肩胛收缩", dose: "2 组 × 10 次" },
        ],
      },
    })),
  },
};

const calendarAggregate = {
  trackerKey: "knee-rehab",
  month: localDate.slice(0, 7),
  days: [
    {
      date: localDate,
      taskCount: 1,
      completedCount: 0,
      skippedCount: 0,
      feedbackCount: 0,
    },
  ],
};

const dayAggregate = {
  trackerKey: "knee-rehab",
  targetDate: localDate,
  plan: todayAggregate.plan,
  day,
};

function dayAggregateFor(date: string) {
  const beforeFormalPlan = date === historyRecordDate;
  return {
    ...dayAggregate,
    targetDate: date,
    day: {
      ...day,
      ...(beforeFormalPlan
        ? {
            state: "not_started" as const,
            startDate: localDate,
            planVersion: null,
            tasks: [],
          }
        : {}),
      externalTrainingRecords: day.externalTrainingRecords.map((record) => ({
        ...record,
        localDate: date,
        occurredAt: `${date}T02:00:00+08:00`,
        details: {
          ...record.details,
          startedAt: `${date}T02:00:00+08:00`,
        },
      })),
    },
  };
}

const integrationStatus = {
  provider: "xunji",
  configured: false,
  maskedKey: null,
  verifiedAt: null,
  updatedAt: null,
  sync: {
    status: "idle",
    lastAttemptAt: null,
    lastSucceededAt: null,
    lastSucceededDate: null,
    lastErrorCode: null,
  },
};

const garminStatus = {
  provider: "garmin",
  state: "connected",
  verifiedAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastErrorCode: null,
};

const garminWellnessProgress = {
  provider: "garmin",
  kind: "daily_wellness",
  sync: {
    status: "idle",
    lastAttemptAt: null,
    lastSucceededDate: null,
    nextCursor: null,
    lastErrorCode: null,
  },
};

const providerHistoryOverview = {
  schemaVersion: "1.0.0",
  range: { from: historyRangeFrom, through: localDate, days: 14 },
  updatedAt: `${localDate}T08:00:00.000Z`,
  scopes: [
    {
      scope: "garmin_activity_history",
      connected: true,
      status: "succeeded",
      nextCursor: null,
      lastErrorCode: null,
      updatedAt: `${localDate}T08:00:00.000Z`,
      summary: {
        processed: 14,
        records: 1,
        empty: 13,
        failed: 0,
        unknown: 0,
      },
    },
    {
      scope: "garmin_wellness_history",
      connected: true,
      status: "running",
      nextCursor: localDate,
      lastErrorCode: null,
      updatedAt: `${localDate}T08:00:00.000Z`,
      summary: {
        processed: 13,
        records: 1,
        empty: 12,
        failed: 0,
        unknown: 1,
      },
    },
    {
      scope: "xunji_training_history",
      connected: false,
      status: "idle",
      nextCursor: null,
      lastErrorCode: null,
      updatedAt: null,
      summary: {
        processed: 0,
        records: 0,
        empty: 0,
        failed: 0,
        unknown: 14,
      },
    },
  ],
  historyRecordDates: [
    {
      date: historyRecordDate,
      sources: ["garmin_activity", "garmin_wellness"],
    },
  ],
  savedRecordDates: [
    {
      date: historyRecordDate,
      sources: ["garmin_activity", "garmin_wellness"],
    },
  ],
};

const deepSeekStatus = {
  schemaVersion: "1.0.0",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  hasCredential: false,
  state: "not_connected",
  verifiedAt: null,
  updatedAt: null,
  lastErrorCode: null,
};

const mirrorStatus = {
  configuration: "configured",
  pendingCount: 0,
  processingCount: 0,
  failedCount: 0,
  oldestPendingAt: null,
  lastSucceededAt: null,
  permissionError: false,
  delayed: false,
};

const trendsAggregate = aggregateEightWeekTrends({
  trackerKey: "knee-rehab",
  trackerStartedOn: "2026-07-01",
  timeZone: "Asia/Shanghai",
  currentDate: localDate,
  generatedAt: new Date().toISOString(),
  planVersions: [
    {
      id: todayAggregate.plan.id,
      version: 1,
      effectiveFrom: "2026-07-01",
    },
  ],
  tasks: [
    {
      id: "019c0000-0000-7000-8000-000000000021",
      localDate,
      planVersionId: todayAggregate.plan.id,
      status: "planned",
      confirmedByUser: false,
      actual: null,
    },
    {
      id: "019c0000-0000-7000-8000-000000000020",
      localDate,
      planVersionId: todayAggregate.plan.id,
      status: "completed",
      confirmedByUser: true,
      actual: { durationMinutes: 35, distanceKm: null },
    },
  ],
  feedbacks: [],
  externalRecords: [],
  wellnessRecords: [
    {
      localDate,
      stepsStatus: "available",
      totalSteps: 1_500,
      sleepStatus: "available",
      totalSleepSeconds: 28_800,
      sleepScore: null,
    },
  ],
});

const emptyTrendsAggregate = aggregateEightWeekTrends({
  trackerKey: "knee-rehab",
  trackerStartedOn: "2026-07-01",
  timeZone: "Asia/Shanghai",
  currentDate: localDate,
  generatedAt: new Date().toISOString(),
  planVersions: [
    {
      id: todayAggregate.plan.id,
      version: 1,
      effectiveFrom: "2026-07-01",
    },
  ],
  tasks: [],
  feedbacks: [],
  externalRecords: [],
  wellnessRecords: [],
});

const planAdvice = {
  schemaVersion: "1.0.0",
  configuration: "configured",
  job: {
    id: "019c0000-0000-7000-8000-000000000031",
    trackerKey: "knee-rehab",
    status: "succeeded",
    errorCode: null,
    retryable: false,
    requestedAt: "2026-07-24T08:00:00.000Z",
    completedAt: "2026-07-24T08:00:02.000Z",
    proposal: {
      id: "019c0000-0000-7000-8000-000000000031",
      basePlanVersionId: "019c0000-0000-7000-8000-000000000001",
      createdAt: "2026-07-24T08:00:02.000Z",
      safetyLevel: "green",
      summary: "Anonymous future adjustment",
      operations: [
        {
          type: "replace_task",
          taskId: "anonymous-task",
          task: {
            id: "anonymous-task",
            title: "Anonymous adjusted task with a long mobile title",
            scheduledDate: "2026-07-26",
            sortOrder: 0,
            category: "general",
            prescription: {},
          },
          reason: "Anonymous reason",
        },
      ],
      status: "proposed",
      application: {
        effectiveFrom: "2026-07-25",
        canAccept: true,
        blockedReason: null,
      },
      decision: null,
      rollback: null,
    },
  },
};

const emptyPlanAdvice = {
  schemaVersion: "1.0.0",
  configuration: "configured",
  selectedModel: "deepseek-v4-flash",
  job: null,
};

const planAdviceContextPreview = {
  schemaVersion: "1.0.0",
  previewHash: "a".repeat(64),
  range: { from: "2026-07-22", through: "2026-08-04" },
  plan: { version: 2, effectiveFrom: "2026-08-03", taskCount: 60 },
  feedback: {
    count: 2,
    days: 2,
    observations: [{ localDate: "2026-08-03", text: "Anonymous note" }],
  },
  confirmedTrainingCount: 1,
  externalTraining: {
    garminActivities: 2,
    xunjiTrainings: 1,
    unconfirmed: 1,
    overlapGroups: 1,
  },
  recovery: { sleepDays: 5, stepsDays: 6 },
  assistantContext: {
    rehabProfileVersion: 2,
    memoryCount: 3,
    sourceConversationIncluded: false,
  },
  coverage: {
    garminActivity: { records: 2, empty: 3, failed: 1, unknown: 8 },
    garminWellness: { records: 5, empty: 1, failed: 0, unknown: 8 },
    xunjiTraining: { records: 1, empty: 4, failed: 0, unknown: 9 },
  },
  safetyLevel: "green",
};

const planWorkspace = {
  schemaVersion: "1.0.0",
  trackerKey: "knee-rehab",
  localDate,
  calendarWeek: 5,
  plan: todayAggregate.plan,
  goals: [],
  nextTraining: {
    localDate: nextLocalDate,
    taskCount: 1,
    titles: ["第 5 周 · Anonymous next training"],
  },
  pendingAdviceCount: 0,
  profileVersion: 2,
  activeMemoryCount: 3,
};

const assistantConversation = {
  schemaVersion: "1.0.0",
  conversationId: null,
  turns: [],
  memories: [],
  profile: null,
  nextCursor: null,
};

const rollbackAdvice = {
  ...planAdvice,
  job: {
    ...planAdvice.job,
    proposal: {
      ...planAdvice.job.proposal,
      status: "accepted",
      application: {
        effectiveFrom: "2026-07-25",
        canAccept: false,
        blockedReason: null,
      },
      decision: {
        type: "accepted",
        decidedAt: "2026-07-24T08:00:03.000Z",
        appliedPlanVersion: {
          id: "019c0000-0000-7000-8000-000000000032",
          version: 2,
          effectiveFrom: "2026-07-25",
        },
      },
      rollback: {
        status: "available",
        blockedReason: null,
        targetBasePlanVersion: {
          id: "019c0000-0000-7000-8000-000000000001",
          version: 1,
        },
        sourceAppliedPlanVersion: {
          id: "019c0000-0000-7000-8000-000000000032",
          version: 2,
          effectiveFrom: "2026-07-25",
        },
        newPlanVersion: null,
        effectiveFrom: "2026-07-25",
        affectedDates: ["2026-07-26"],
        decidedAt: null,
      },
    },
  },
};

const evaluationSnapshot = {
  schemaVersion: "1.0.0",
  id: "019c0000-0000-7000-8000-000000000041",
  trackerKey: "knee-rehab",
  kind: "final",
  triggerDate: localDate,
  targetDate: localDate,
  planningTimeZone: "Asia/Shanghai",
  calculationVersion: "evaluation-evidence-v1",
  createdAt: `${localDate}T00:00:00.000Z`,
  evidenceRange: { from: localDate, through: localDate },
  basePlanVersion: {
    id: "019c0000-0000-7000-8000-000000000042",
    version: 1,
    effectiveFrom: localDate,
  },
  timelineHeadPlanVersion: {
    id: "019c0000-0000-7000-8000-000000000042",
    version: 1,
    effectiveFrom: localDate,
  },
  effectiveness: { status: "needs_policy", policyVersion: null },
  weeks: [],
};

const evaluationAggregate = {
  trackerKey: "knee-rehab",
  currentDate: localDate,
  targetDate: localDate,
  planningTimeZone: "Asia/Shanghai",
  state: "opened",
  session: { ...evaluationSnapshot, status: "open" },
  result: null,
  resultSubmission: { allowed: true, blockedReason: null },
};

const evaluationDecisionAggregate = {
  ...evaluationAggregate,
  session: {
    ...evaluationAggregate.session,
    weeks: [
      {
        weekStart: localDate,
        weekEnd: localDate,
        tasks: { total: 1, completed: 1, skipped: 0, planned: 0 },
        feedback: {
          feedbackDays: 1,
          expectedDays: 1,
          maxPain: 2,
          worstSafetyLevel: "green",
        },
        execution: {
          pauseDays: 0,
          travelDays: 0,
          equipmentLimitedDays: 0,
          degradedDays: 0,
        },
        loadCoverage: {
          completedTasks: 1,
          durationCoveredTasks: 1,
          distanceCoveredTasks: 0,
          sourceCoveredTasks: 0,
        },
        effectiveness: { status: "needs_policy", policyVersion: null },
      },
    ],
  },
  result: {
    schemaVersion: "1.0.0",
    resultVersion: "evaluation-result-v1",
    id: "019c0000-0000-7000-8000-000000000043",
    sessionId: evaluationSnapshot.id,
    trackerKey: "knee-rehab",
    kind: "final",
    submittedAt: `${localDate}T01:00:00.000Z`,
    submittedLocalDate: localDate,
    basePlanVersionId: evaluationSnapshot.basePlanVersion.id,
    timelineHeadPlanVersionId: evaluationSnapshot.timelineHeadPlanVersion.id,
    goalCompletion: "partially_met",
    sides: {
      left: {
        symptomResponse: "mild",
        strengthAndControl: "ready",
        loadTolerance: "limited",
      },
      right: {
        symptomResponse: "none",
        strengthAndControl: "ready",
        loadTolerance: "ready",
      },
    },
    nextStageIntent: "undecided",
  },
  decision: null,
  resultSubmission: { allowed: false, blockedReason: "already_recorded" },
  decisionSubmission: {
    allowed: true,
    blockedReason: null,
    allowedBranches: ["maintain", "progress", "extend", "professional_review"],
    progressBlockedReason: null,
  },
};

type RequestCounters = {
  today: number;
  month: number;
  day: number;
  integration: number;
  garmin: number;
  deepseek: number;
  mirror: number;
  trends: number;
  advice: number;
  evaluation: number;
  association: number;
};

type MockPrivateReadOptions = {
  today?: unknown | (() => unknown);
  day?: (date: string) => unknown;
  association?: (body: Record<string, unknown>) => unknown;
  integration?: unknown | (() => unknown);
  garmin?: unknown | (() => unknown);
};

async function authorize(context: BrowserContext) {
  const token = await encode({
    secret: "anonymous-navigation-browser-test-secret",
    token: { sub: "10001", githubId: "10001", name: "Anonymous User" },
  });
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function mockPrivateReads(
  page: Page,
  delayMs: number,
  advice: unknown = planAdvice,
  evaluation: unknown = evaluationAggregate,
  trends: unknown = trendsAggregate,
  options: MockPrivateReadOptions = {},
) {
  const counters: RequestCounters = {
    today: 0,
    month: 0,
    day: 0,
    integration: 0,
    garmin: 0,
    deepseek: 0,
    mirror: 0,
    trends: 0,
    advice: 0,
    evaluation: 0,
    association: 0,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = null;
    if (
      request.method() === "PUT" &&
      url.pathname.endsWith("/association") &&
      options.association
    ) {
      counters.association += 1;
      body = options.association(
        JSON.parse(request.postData() ?? "{}") as Record<string, unknown>,
      );
    } else if (url.pathname.endsWith("/today")) {
      counters.today += 1;
      body =
        typeof options.today === "function"
          ? options.today()
          : (options.today ?? todayAggregate);
    } else if (url.pathname.endsWith("/plan-workspace")) {
      body = planWorkspace;
    } else if (url.pathname.endsWith("/assistant")) {
      body = assistantConversation;
    } else if (url.pathname.endsWith("/calendar")) {
      counters.month += 1;
      body = calendarAggregate;
    } else if (/\/days\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) {
      counters.day += 1;
      const requestedDate = url.pathname.slice(-10);
      body = options.day
        ? options.day(requestedDate)
        : dayAggregateFor(requestedDate);
    } else if (url.pathname.endsWith("/integrations/history-sync")) {
      body = providerHistoryOverview;
    } else if (url.pathname.endsWith("/integrations/xunji/credential")) {
      counters.integration += 1;
      body =
        typeof options.integration === "function"
          ? options.integration()
          : (options.integration ?? integrationStatus);
    } else if (url.pathname.endsWith("/integrations/garmin/credential")) {
      counters.garmin += 1;
      body =
        typeof options.garmin === "function"
          ? options.garmin()
          : (options.garmin ?? garminStatus);
    } else if (url.pathname.endsWith("/integrations/garmin/wellness")) {
      body = garminWellnessProgress;
    } else if (url.pathname.endsWith("/integrations/deepseek/credential")) {
      counters.deepseek += 1;
      body = deepSeekStatus;
    } else if (url.pathname === "/api/mirror/status") {
      counters.mirror += 1;
      body = mirrorStatus;
    } else if (url.pathname.endsWith("/ai-analysis/context-preview")) {
      body = planAdviceContextPreview;
    } else if (url.pathname.endsWith("/ai-analysis")) {
      counters.advice += 1;
      body = request.method() === "POST" ? planAdvice : advice;
    } else if (url.pathname.endsWith("/trends")) {
      counters.trends += 1;
      body = trends;
    } else if (url.pathname.endsWith("/evaluation")) {
      counters.evaluation += 1;
      body = evaluation;
    } else if (url.pathname === "/api/mirror/sync") {
      body = {
        result: {
          status: "idle",
          processed: 0,
          succeeded: 0,
          failed: 0,
        },
        status: mirrorStatus,
      };
    }
    if (body === null) {
      await route.fulfill({ status: 404, json: { error: "not_found" } });
      return;
    }
    if (delayMs > 0 && request.method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.fulfill({ status: 200, json: body });
  });
  return counters;
}

function externalAssociationScenario() {
  const recordId = day.externalTrainingRecords[0]!.id;
  const mutableDay = structuredClone(day) as unknown as TodayDashboard;
  mutableDay.externalTrainingRecords.push({
    id: "019c0000-0000-7000-8000-000000000005",
    provider: "garmin",
    localDate,
    occurredAt: `${localDate}T05:00:00+08:00`,
    sourceVersion: 1,
    details: {
      kind: "activity",
      activityType: "walking",
      startedAt: `${localDate}T05:00:00+08:00`,
      durationSeconds: 1_200,
      distanceMeters: 1_400,
      averagePaceSecondsPerKilometer: 857,
      averageHeartRateBpm: 90,
    },
    association: {
      status: "unrelated",
      taskId: null,
      sourceVersion: 1,
      needsReview: false,
    },
    suggestion: null,
  });

  return {
    recordId,
    today: () => ({
      ...todayAggregate,
      day: structuredClone(mutableDay),
    }),
    selectedDay: (date: string) =>
      date === localDate
        ? {
            ...dayAggregate,
            day: structuredClone(mutableDay),
          }
        : dayAggregateFor(date),
    associate: (body: Record<string, unknown>) => {
      const target = mutableDay.externalTrainingRecords.find(
        (record) => record.id === body.externalRecordId,
      );
      if (!target) throw new Error("anonymous_record_not_found");
      const association =
        body.decision === "unrelated"
          ? {
              status: "unrelated" as const,
              taskId: null,
              sourceVersion: target.sourceVersion,
              needsReview: false,
            }
          : {
              status: "confirmed" as const,
              taskId: String(body.taskId),
              sourceVersion: target.sourceVersion,
              needsReview: false,
            };
      target.association = association;
      target.suggestion = null;
      return {
        commandId: String(body.commandId),
        replayed: false,
        recordId: target.id,
        association,
      };
    },
  };
}

async function expectMobileLayoutIntegrity(page: Page) {
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const isVisible = (element: HTMLElement) => {
      const closedDetails = element.closest<HTMLDetailsElement>("details");
      if (
        closedDetails &&
        !closedDetails.open &&
        element.tagName.toLowerCase() !== "summary"
      ) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inViewportHorizontally = (rect: DOMRect) =>
      rect.left >= -0.5 && rect.right <= viewportWidth + 0.5;
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        "main button, main a[href], main select, main textarea, main input:not([type='checkbox']), main summary, main label.task-check",
      ),
    ].filter(isVisible);
    const textBlocks = [
      ...document.querySelectorAll<HTMLElement>(
        "main p, main h1, main h2, main h3, main label, main summary, main .settings-row-copy",
      ),
    ].filter(
      (element) =>
        isVisible(element) &&
        window.getComputedStyle(element).display !== "inline",
    );
    const cardSelector =
      ".surface-card, .today-section, .today-task, .settings-list-group, .calendar-day-detail, .feedback-safety-preview";
    const errors = [
      ...controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        const card = control.closest<HTMLElement>(cardSelector);
        const cardRect = card?.getBoundingClientRect();
        const errors = [] as string[];
        if (!inViewportHorizontally(rect))
          errors.push("control-overflows-viewport");
        if (rect.height < 44) {
          errors.push(
            `control-under-44px:${control.tagName.toLowerCase()}:${control.className}:${control.textContent?.trim().slice(0, 40)}`,
          );
        }
        if (
          cardRect &&
          (rect.left < cardRect.left - 0.5 ||
            rect.right > cardRect.right + 0.5 ||
            rect.top < cardRect.top - 0.5 ||
            rect.bottom > cardRect.bottom + 0.5)
        ) {
          errors.push("control-escapes-card");
        }
        return errors;
      }),
      ...textBlocks.flatMap((text) => {
        const rect = text.getBoundingClientRect();
        if (!inViewportHorizontally(rect)) return ["text-overflows-viewport"];
        return text.scrollWidth > text.clientWidth + 1 ||
          text.scrollHeight > text.clientHeight + 1
          ? ["text-is-clipped"]
          : [];
      }),
    ];

    const flowOverlap = [...document.querySelectorAll<HTMLElement>("main p")]
      .filter(isVisible)
      .flatMap((copy) => {
        const next = copy.nextElementSibling;
        if (
          !(next instanceof HTMLElement) ||
          !isVisible(next) ||
          !next.matches("a[href], button, label, select, textarea, input")
        ) {
          return [];
        }
        const copyRect = copy.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        return copyRect.bottom > nextRect.top + 0.5
          ? ["copy-overlaps-action"]
          : [];
      });

    const bottomNav = document.querySelector<HTMLElement>(
      'nav[aria-label="主导航"]',
    );
    const nonNavControls = controls.filter(
      (control) => !bottomNav?.contains(control),
    );
    const lastControl = [...nonNavControls]
      .sort(
        (left, right) =>
          right.getBoundingClientRect().bottom -
          left.getBoundingClientRect().bottom,
      )
      .at(-1);
    lastControl?.scrollIntoView({ block: "end" });
    const lastControlRect = lastControl?.getBoundingClientRect();
    const bottomNavRect = bottomNav?.getBoundingClientRect();

    return {
      errors: [...errors, ...flowOverlap],
      lastControlCoveredByBottomNav: Boolean(
        lastControlRect &&
        bottomNavRect &&
        lastControlRect.bottom > bottomNavRect.top + 0.5 &&
        lastControlRect.top < viewportHeight,
      ),
    };
  });

  expect(layout.errors).toEqual([]);
  expect(layout.lastControlCoveredByBottomNav).toBe(false);
}

async function expectTodayR9VisualContract(
  page: Page,
  expectedTaskTitle?: string,
) {
  const contract = await page.evaluate((taskTitle) => {
    const toolbarActions = [
      ...document.querySelectorAll<HTMLElement>("[data-ak-toolbar-variant]"),
    ];
    const toolbarStyles = toolbarActions.map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        variant: element.dataset.akToolbarVariant,
        background: style.backgroundColor,
        border: style.border,
        radius: style.borderRadius,
        height: rect.height,
        centerY: rect.top + rect.height / 2,
      };
    });
    const footerRows = [
      ...document.querySelectorAll<HTMLElement>("[data-ak-action-row='true']"),
    ];
    const prescriptionRows = [
      ...document.querySelectorAll<HTMLElement>(
        ".today-prescription .ak-list-row",
      ),
    ];
    const taskTitles = [
      ...document.querySelectorAll<HTMLElement>(
        ".today-task-summary .task-summary-copy strong",
      ),
    ].map((element) => element.textContent?.trim());
    return {
      toolbarStyles,
      footerRows: footerRows.map((element) => {
        const style = getComputedStyle(element);
        return {
          radius: style.borderRadius,
          borderTop: style.borderTop,
          height: element.getBoundingClientRect().height,
        };
      }),
      prescriptionRows: prescriptionRows.map((row, index) => {
        const inner = row.querySelector<HTMLElement>(".ak-list-row-inner");
        const rowStyle = getComputedStyle(row);
        const pseudoStyle = inner ? getComputedStyle(inner, "::after") : null;
        const pseudoVisible = Boolean(
          pseudoStyle &&
          pseudoStyle.display !== "none" &&
          pseudoStyle.content !== "none" &&
          Number.parseFloat(pseudoStyle.height) > 0 &&
          pseudoStyle.backgroundColor !== "rgba(0, 0, 0, 0)",
        );
        return {
          index,
          rowBorderBottomWidth: Number.parseFloat(rowStyle.borderBottomWidth),
          pseudoVisible,
          pseudoHeight: pseudoStyle ? Number.parseFloat(pseudoStyle.height) : 0,
        };
      }),
      taskTitleCount: taskTitle
        ? taskTitles.filter((title) => title === taskTitle).length
        : null,
    };
  }, expectedTaskTitle);

  expect(contract.toolbarStyles).toHaveLength(2);
  expect(new Set(contract.toolbarStyles.map(({ variant }) => variant))).toEqual(
    new Set(["tonal"]),
  );
  expect(
    new Set(contract.toolbarStyles.map(({ background }) => background)).size,
  ).toBe(1);
  expect(new Set(contract.toolbarStyles.map(({ border }) => border)).size).toBe(
    1,
  );
  expect(new Set(contract.toolbarStyles.map(({ radius }) => radius)).size).toBe(
    1,
  );
  expect(
    new Set(contract.toolbarStyles.map(({ height }) => Math.round(height))),
  ).toEqual(new Set([44]));
  expect(
    Math.max(...contract.toolbarStyles.map(({ centerY }) => centerY)) -
      Math.min(...contract.toolbarStyles.map(({ centerY }) => centerY)),
  ).toBeLessThanOrEqual(0.5);
  expect(contract.footerRows.length).toBeGreaterThanOrEqual(2);
  expect(new Set(contract.footerRows.map(({ radius }) => radius))).toEqual(
    new Set(["0px"]),
  );
  expect(
    contract.footerRows.every(
      ({ height, borderTop }) =>
        height >= 44 && borderTop !== "0px none rgb(0, 0, 0)",
    ),
  ).toBe(true);
  expect(contract.prescriptionRows.length).toBeGreaterThanOrEqual(1);
  expect(
    contract.prescriptionRows.every(
      ({ rowBorderBottomWidth }) => rowBorderBottomWidth === 0,
    ),
  ).toBe(true);
  for (const [index, row] of contract.prescriptionRows.entries()) {
    if (index === contract.prescriptionRows.length - 1) {
      expect(row.pseudoVisible).toBe(false);
    } else {
      expect(row.pseudoVisible).toBe(true);
      expect(row.pseudoHeight).toBeGreaterThan(0);
    }
  }
  if (expectedTaskTitle) expect(contract.taskTitleCount).toBe(1);
}

test("UI-R9 Today density contract holds for the Chinese fixture", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPrivateReads(
    page,
    0,
    planAdvice,
    evaluationAggregate,
    trendsAggregate,
    { today: todayR9ChineseFixture },
  );
  await page.goto("/");
  await expect(page.getByText("上肢综合训练", { exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "收起 上肢综合训练" }).click();
  const collapsed = await page.evaluate(() => {
    const workout = document.querySelector<HTMLElement>("[data-today-workout]");
    const header = workout?.querySelector<HTMLElement>(".ak-card-header");
    const taskSummary = workout?.querySelector<HTMLElement>(
      ".today-task-summary",
    );
    const adjustment = workout?.querySelector<HTMLElement>(
      ".today-adjustment-entry",
    );
    const cardRect = workout?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const taskRect = taskSummary?.getBoundingClientRect();
    const adjustmentRect = adjustment?.getBoundingClientRect();
    const gaps = [
      headerRect && taskRect ? taskRect.top - headerRect.bottom : 0,
      taskRect && adjustmentRect ? adjustmentRect.top - taskRect.bottom : 0,
      cardRect && adjustmentRect ? cardRect.bottom - adjustmentRect.bottom : 0,
    ];
    return {
      height: cardRect?.height ?? 0,
      gaps,
      feedbackHeight:
        document
          .querySelector<HTMLElement>("[data-today-feedback]")
          ?.getBoundingClientRect().height ?? 0,
    };
  });
  expect.soft(collapsed.height).toBeLessThanOrEqual(220);
  expect.soft(Math.max(...collapsed.gaps)).toBeLessThanOrEqual(20);
  expect.soft(collapsed.feedbackHeight).toBeLessThanOrEqual(88);

  await page.getByRole("button", { name: "展开 上肢综合训练" }).click();
  const expanded = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        ".today-prescription .ak-list-row",
      ),
    ];
    const toolbar = [
      ...document.querySelectorAll<HTMLElement>("[data-ak-toolbar-variant]"),
    ];
    const sync = document.querySelector<HTMLElement>(".today-sync-button");
    const syncStyle = sync ? getComputedStyle(sync) : null;
    return {
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      toolbarWidth: sync?.getBoundingClientRect().width ?? 0,
      toolbarWidthStyle: syncStyle?.width ?? "",
      toolbarGap: Number.parseFloat(syncStyle?.gap ?? "-1"),
      toolbarCount: toolbar.length,
    };
  });
  expect.soft(expanded.rowHeights).toHaveLength(4);
  expect
    .soft(expanded.rowHeights.every((height) => height >= 56 && height <= 64))
    .toBe(true);
  expect.soft(expanded.toolbarCount).toBe(2);
  expect.soft(expanded.toolbarWidth).toBeLessThanOrEqual(92);
  expect.soft(expanded.toolbarWidthStyle).not.toBe("100%");
  expect.soft(expanded.toolbarGap).toBeGreaterThanOrEqual(6);
  expect.soft(expanded.toolbarGap).toBeLessThanOrEqual(8);
});

test("UI-R5 production Today information architecture stays flat and actionable", async ({
  page,
}) => {
  const fixture = structuredClone(todayAggregate);
  Object.assign(fixture.day.tasks[0], {
    title: "较长轻松跑",
    description: "周五下班后执行；当前限制以膝部组织耐受为准。",
    prescription: {
      warmup: "快走 5 分钟",
      main: "慢跑 2 分钟 + 步行 1 分钟，循环 6 次",
      target: "累计慢跑 12 分钟",
      cooldown: "快走 5 分钟",
      gate: "仅在本周此前跑步和力量训练均为绿灯时执行",
    },
  });
  await mockPrivateReads(
    page,
    0,
    planAdvice,
    evaluationAggregate,
    trendsAggregate,
    { today: fixture },
  );
  await page.goto("/");
  await expect(page.getByRole("region", { name: "今日训练" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "训练记录", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "较长轻松跑" })).toBeVisible();
  await expect(page.getByText("热身", { exact: true })).toBeVisible();
  await expect(page.getByText("主训练", { exact: true })).toBeVisible();
  await expect(page.getByText("结束", { exact: true })).toBeVisible();
  await expect(page.getByText("训练内容", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/ak22ak-ui-r5-after.png",
    fullPage: true,
  });

  const structure = await page.evaluate(() => {
    const workout = document.querySelector<HTMLElement>("[data-today-workout]");
    const records = document.querySelector<HTMLElement>("[data-today-records]");
    const feedback = document.querySelector<HTMLElement>(
      "[data-today-feedback]",
    );
    return {
      todaySections: [workout, records, feedback].map((section) =>
        section?.getAttribute("aria-label"),
      ),
      recordsIsSibling: Boolean(
        workout &&
        records &&
        workout.parentElement === records.parentElement &&
        workout.compareDocumentPosition(records) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      feedbackIsSibling: Boolean(
        records &&
        feedback &&
        records.parentElement === feedback.parentElement &&
        records.compareDocumentPosition(feedback) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      recordsInsideWorkout: Boolean(workout?.contains(records)),
      singleTaskIsWorkoutBody: Boolean(workout?.querySelector(".today-task")),
      singleTaskHeading: workout
        ?.querySelector(".ak-card-header h2")
        ?.textContent?.trim(),
      singleTaskCountBadge:
        workout?.querySelector(".count-badge")?.textContent?.trim() ?? null,
      singleTaskStatusPills: [
        ...(workout?.querySelectorAll(".today-task-summary > .status-pill") ??
          []),
      ].map((pill) => pill.textContent?.trim()),
      singleTaskVisibleTitleCount: workout?.querySelectorAll(
        ".today-task-summary .task-summary-copy > strong",
      ).length,
      hasLegacyRemainingHeading:
        document.body.innerText.includes("今天还剩 1 项"),
      recordsHeading: records
        ?.querySelector(".ak-card-header h2")
        ?.textContent?.trim(),
      recordsStatus:
        records?.querySelector(".today-sync-status")?.textContent?.trim() ??
        null,
      mergedTargetCount: (
        document.body.innerText.match(/累计慢跑 12 分钟/g) ?? []
      ).length,
      nestedTaskCard: Boolean(
        document.querySelector("[data-ak-card] [data-ak-card]"),
      ),
      templateDescriptionVisible: document.body.innerText.includes(
        "周五下班后执行；当前限制以膝部组织耐受为准。",
      ),
      executionConditionVisible: document.body.innerText.includes(
        "仅在本周此前跑步和力量训练均为绿灯时执行",
      ),
    };
  });

  expect
    .soft(structure.todaySections)
    .toEqual(["今日训练", "训练记录", "身体反馈"]);
  expect.soft(structure.recordsIsSibling).toBe(true);
  expect.soft(structure.feedbackIsSibling).toBe(true);
  expect.soft(structure.recordsInsideWorkout).toBe(false);
  expect.soft(structure.singleTaskIsWorkoutBody).toBe(true);
  expect.soft(structure.singleTaskHeading).toBe("今日训练");
  expect.soft(structure.singleTaskCountBadge).toBeNull();
  expect.soft(structure.singleTaskStatusPills).toEqual(["待完成"]);
  expect.soft(structure.singleTaskVisibleTitleCount).toBe(1);
  expect.soft(structure.hasLegacyRemainingHeading).toBe(false);
  expect.soft(structure.recordsHeading).toBe("训练记录");
  expect.soft(structure.recordsHeading).not.toBe("同步状态");
  expect.soft(structure.recordsStatus).toBeNull();
  expect.soft(structure.mergedTargetCount).toBe(1);
  expect.soft(structure.nestedTaskCard).toBe(false);
  expect.soft(structure.templateDescriptionVisible).toBe(false);
  expect.soft(structure.executionConditionVisible).toBe(false);
});

for (const width of [320, 375, 390, 393, 430]) {
  test(`today feedback action remains in flow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/");

    const feedbackAction = page.getByRole("link", { name: "记录身体反馈" });
    await expect(feedbackAction).toBeVisible();
    const adjustment = page.getByRole("button", { name: "调整今天" });
    await expect(adjustment).toBeVisible();
    await expect(adjustment).toHaveAttribute("aria-expanded", "false");
    await expect(adjustment).toHaveAttribute(
      "aria-controls",
      "today-adjustments",
    );

    const layout = await page.evaluate(() => {
      const feedbackCard =
        document.querySelector<HTMLElement>(".feedback-card");
      const safetyCard = document.querySelector<HTMLElement>(
        ".feedback-card-yellow, .feedback-card-red",
      );
      const feedbackAction = feedbackCard?.querySelector<HTMLElement>(
        'a[href="/feedback"]',
      );
      const planCard = document.querySelector<HTMLElement>(
        ".today-training-section",
      );
      const planHeading =
        planCard?.querySelector<HTMLElement>(".ak-card-header");
      const adjustment = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.trim() === "调整今天");
      const feedbackCardRect = feedbackCard?.getBoundingClientRect();
      const feedbackActionRect = feedbackAction?.getBoundingClientRect();
      const planCardRect = planCard?.getBoundingClientRect();
      const planHeadingRect = planHeading?.getBoundingClientRect();
      const planHeadingStyle = planHeading
        ? getComputedStyle(planHeading)
        : null;
      const adjustmentRect = adjustment?.getBoundingClientRect();
      const headingPaddingLeft = Number.parseFloat(
        planHeadingStyle?.paddingLeft ?? "0",
      );
      const headingPaddingRight = Number.parseFloat(
        planHeadingStyle?.paddingRight ?? "0",
      );
      return {
        feedbackCardRect,
        hasSafetyCard: Boolean(safetyCard),
        feedbackActionRect,
        actionHeight: feedbackActionRect?.height ?? 0,
        adjustmentInPlanCard: Boolean(planCard?.contains(adjustment ?? null)),
        planCardRect,
        adjustmentRect,
        headingContentLeft: (planHeadingRect?.left ?? 0) + headingPaddingLeft,
        headingContentRight:
          (planHeadingRect?.right ?? 0) - headingPaddingRight,
        adjustmentHeight: adjustmentRect?.height ?? 0,
        adjustmentTextFits:
          adjustment !== undefined &&
          adjustment.scrollWidth <= adjustment.clientWidth + 1,
      };
    });

    expect(layout.hasSafetyCard).toBe(false);
    expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
    expect(layout.feedbackActionRect?.top).toBeGreaterThanOrEqual(
      (layout.feedbackCardRect?.top ?? Number.POSITIVE_INFINITY) + 10,
    );
    expect(layout.feedbackActionRect?.left).toBeGreaterThanOrEqual(
      layout.feedbackCardRect?.left ?? Number.POSITIVE_INFINITY,
    );
    expect(layout.feedbackActionRect?.right).toBeLessThanOrEqual(
      layout.feedbackCardRect?.right ?? Number.NEGATIVE_INFINITY,
    );
    expect(layout.feedbackActionRect?.bottom).toBeLessThanOrEqual(
      layout.feedbackCardRect?.bottom ?? Number.NEGATIVE_INFINITY,
    );
    expect(layout.adjustmentInPlanCard).toBe(true);
    expect(layout.adjustmentRect?.left).toBeGreaterThanOrEqual(
      layout.headingContentLeft - 1,
    );
    expect(layout.adjustmentRect?.right).toBeLessThanOrEqual(
      layout.headingContentRight + 1,
    );
    expect(layout.adjustmentRect?.right).toBeLessThanOrEqual(
      layout.planCardRect?.right ?? Number.NEGATIVE_INFINITY,
    );
    expect(layout.adjustmentHeight).toBeGreaterThanOrEqual(44);
    expect(layout.adjustmentTextFits).toBe(true);

    await adjustment.click();
    await expect(adjustment).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#today-adjustments")).toBeVisible();
  });
}

for (const width of [320, 375, 390, 393, 430]) {
  test(`today latest-record sync stays bounded and readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const todayWithSchedulePrefix = {
      ...todayAggregate,
      day: {
        ...todayAggregate.day,
        tasks: todayAggregate.day.tasks.map((task) => ({
          ...task,
          title: "第 5 周 · Anonymous task",
        })),
      },
    };
    await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      trendsAggregate,
      { today: todayWithSchedulePrefix },
    );
    let requests = 0;
    let release!: () => void;
    const responseReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      "**/api/trackers/knee-rehab/integrations/sync-latest",
      async (route) => {
        requests += 1;
        await responseReleased;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            sources: [
              {
                source: "garmin_activity",
                status: "records",
                recordCount: 1,
                continueAvailable: true,
              },
              {
                source: "garmin_wellness",
                status: "temporarily_failed",
                recordCount: 0,
                continueAvailable: false,
              },
              {
                source: "xunji_training",
                status: "needs_credentials",
                recordCount: 0,
                continueAvailable: false,
              },
            ],
          }),
        });
      },
    );
    await page.goto("/");

    const task = page.locator(".today-task").first();
    await expect(
      task.getByRole("button", { name: "收起 Anonymous task" }),
    ).toBeVisible();
    await expect(task.locator(".today-task-details")).toBeVisible();
    await expect(
      task.getByRole("button", { name: "收起 Anonymous task" }),
    ).toBeVisible();
    const taskBeforeSync = await page.evaluate(() => {
      const task = document.querySelector(".today-task");
      const sync = document.querySelector("[data-today-records]");
      return task && sync
        ? Boolean(
            task.compareDocumentPosition(sync) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false;
    });
    expect(taskBeforeSync).toBe(true);

    const syncButton = page.getByRole("button", { name: "同步外部训练记录" });
    const titleTopBeforeSync = await page
      .locator(".ak-screen-header-copy h1")
      .evaluate((element) => element.getBoundingClientRect().top);
    await syncButton.dblclick();
    await expect(
      page.getByRole("button", { name: "正在同步外部训练记录" }),
    ).toBeDisabled();
    expect(requests).toBe(1);
    const syncRunningLayout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".today-header");
      const actions = document.querySelector<HTMLElement>(
        ".ak-screen-header-actions",
      );
      const status = document.querySelector<HTMLElement>(".today-sync-status");
      const sourceRows = [
        ...(status?.querySelectorAll<HTMLElement>(".today-sync-results li") ??
          []),
      ];
      const title = document.querySelector<HTMLElement>(
        ".ak-screen-header-copy h1",
      );
      const headerRect = header?.getBoundingClientRect();
      const statusRect = status?.getBoundingClientRect();
      return {
        headerWidth: headerRect?.width ?? 0,
        headerLeft: headerRect?.left ?? 0,
        headerRight: headerRect?.right ?? 0,
        actionsWidth: actions?.getBoundingClientRect().width ?? 0,
        statusWidth: statusRect?.width ?? 0,
        statusLeft: statusRect?.left ?? 0,
        statusRight: statusRect?.right ?? 0,
        statusInActions: Boolean(status && actions?.contains(status)),
        statusInHeader: Boolean(status && header?.contains(status)),
        titleTop: title?.getBoundingClientRect().top ?? 0,
        sourceRowWidths: sourceRows.map(
          (row) => row.getBoundingClientRect().width,
        ),
      };
    });
    expect(syncRunningLayout.statusWidth).toBeGreaterThanOrEqual(
      syncRunningLayout.headerWidth - 4,
    );
    expect(syncRunningLayout.statusRight).toBeLessThanOrEqual(
      syncRunningLayout.headerRight + 1,
    );
    expect(syncRunningLayout.statusLeft).toBeGreaterThanOrEqual(
      syncRunningLayout.headerLeft - 1,
    );
    expect(syncRunningLayout.statusInActions).toBe(false);
    expect(syncRunningLayout.statusInHeader).toBe(true);
    expect(syncRunningLayout.titleTop).toBeCloseTo(titleTopBeforeSync, 0);
    expect(
      syncRunningLayout.sourceRowWidths.every(
        (width) => width >= syncRunningLayout.statusWidth - 28,
      ),
    ).toBe(true);
    release();

    await expect(page.getByText("有记录 · 继续同步")).toBeVisible();
    await expect(page.getByText("暂时失败")).toBeVisible();
    await expect(page.getByText("需更新凭证")).toBeVisible();
    const syncPartialLayout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".today-header");
      const status = document.querySelector<HTMLElement>(".today-sync-status");
      const headerRect = header?.getBoundingClientRect();
      const statusRect = status?.getBoundingClientRect();
      return {
        headerWidth: headerRect?.width ?? 0,
        headerLeft: headerRect?.left ?? 0,
        headerRight: headerRect?.right ?? 0,
        statusWidth: statusRect?.width ?? 0,
        statusLeft: statusRect?.left ?? 0,
        statusRight: statusRect?.right ?? 0,
        statusInActions: Boolean(
          status &&
          document.querySelector(".ak-screen-header-actions")?.contains(status),
        ),
      };
    });
    expect(syncPartialLayout.statusWidth).toBeGreaterThanOrEqual(
      syncPartialLayout.headerWidth - 4,
    );
    expect(syncPartialLayout.statusLeft).toBeGreaterThanOrEqual(
      syncPartialLayout.headerLeft - 1,
    );
    expect(syncPartialLayout.statusRight).toBeLessThanOrEqual(
      syncPartialLayout.headerRight + 1,
    );
    expect(syncPartialLayout.statusInActions).toBe(false);
    if (width === 390) {
      await page.screenshot({
        path: "test-results/ui-r9-today-sync-partial-390.png",
        fullPage: true,
      });
    }
    await expectMobileLayoutIntegrity(page);
  });
}

test("UI-R9 390px Today states keep the new information hierarchy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const chineseReviewScreenshotPath =
    process.env.UI_R9_SCREENSHOT_PATH ??
    "test-results/ui-r9-today-chinese-390.png";
  const chineseCollapsedScreenshotPath =
    process.env.UI_R9_COLLAPSED_SCREENSHOT_PATH ??
    "test-results/ui-r9-today-chinese-collapsed-390.png";
  const chineseFooterScreenshotPath =
    process.env.UI_R9_FOOTER_SCREENSHOT_PATH ??
    "test-results/ui-r9-today-chinese-footer-390.png";
  let activeToday: unknown = todayR9ChineseFixture;
  await mockPrivateReads(
    page,
    0,
    planAdvice,
    evaluationAggregate,
    trendsAggregate,
    { today: () => activeToday },
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "今天", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("尚未检查新记录")).toHaveCount(0);
  await expect(page.locator("[data-today-records]")).toHaveCount(0);
  await expect(page.getByText("今日训练", { exact: true })).toHaveCount(1);
  await expect(page.getByText("身体反馈", { exact: true })).toHaveCount(1);
  await expect(page.getByText("今天还没有记录")).toHaveCount(0);
  await expect(page.getByText("告诉康复助手")).toHaveCount(0);
  await expect(page.getByText("上肢综合训练", { exact: true })).toHaveCount(1);
  await expectTodayR9VisualContract(page, "上肢综合训练");
  const headerContract = await page.evaluate(() => {
    const h1 = document.querySelector<HTMLElement>(".ak-screen-header-copy h1");
    const date = document.querySelector<HTMLElement>(
      ".ak-screen-header-copy p",
    );
    const actions = [
      ...document.querySelectorAll<HTMLElement>(
        ".ak-screen-header-actions > button",
      ),
    ];
    return {
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      h1Leading: h1 ? getComputedStyle(h1).lineHeight : null,
      dateSize: date ? getComputedStyle(date).fontSize : null,
      dateLeading: date ? getComputedStyle(date).lineHeight : null,
      sectionHeadings: [
        ...document.querySelectorAll<HTMLElement>(
          ".today-section .ak-card-header h2, .today-section .ak-compact-action-row h2",
        ),
      ].map((heading) => {
        const rect = heading.getBoundingClientRect();
        const style = getComputedStyle(heading);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          x: rect.x,
        };
      }),
      actionHeights: actions.map(
        (action) => action.getBoundingClientRect().height,
      ),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(headerContract.h1Size).toBe("34px");
  expect(headerContract.h1Leading).toBe("41px");
  expect(headerContract.dateSize).toBe("17px");
  expect(headerContract.dateLeading).toBe("22px");
  expect(headerContract.sectionHeadings).toHaveLength(2);
  expect(
    new Set(headerContract.sectionHeadings.map(({ fontSize }) => fontSize)),
  ).toEqual(new Set(["17px"]));
  expect(
    new Set(headerContract.sectionHeadings.map(({ lineHeight }) => lineHeight)),
  ).toEqual(new Set(["22px"]));
  expect(
    new Set(headerContract.sectionHeadings.map(({ x }) => x).map(Math.round))
      .size,
  ).toBe(1);
  expect(headerContract.actionHeights.every((height) => height >= 44)).toBe(
    true,
  );
  expect(headerContract.overflow).toBe(false);
  await page.getByRole("button", { name: "收起 上肢综合训练" }).click();
  await page.screenshot({
    path: chineseCollapsedScreenshotPath,
    fullPage: true,
  });
  await page.getByRole("button", { name: "展开 上肢综合训练" }).click();
  await page.screenshot({
    path: chineseReviewScreenshotPath,
    fullPage: true,
  });
  await page.getByRole("button", { name: "今天跳过" }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: chineseFooterScreenshotPath,
  });

  activeToday = { ...todayR9ChineseFixture, day: todayAggregate.day };
  await page.goto("/");
  await expect(page.locator("[data-today-records]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "训练记录" })).toBeVisible();
  await page.screenshot({
    path: "test-results/ui-r9-today-records-390.png",
    fullPage: true,
  });

  for (const safety of ["yellow", "red"] as const) {
    activeToday = {
      ...todayAggregate,
      day: {
        ...todayAggregate.day,
        feedbackCount: 1,
        feedbacks: [anonymousFeedback(safety)],
      },
    };
    await page.goto("/");
    const feedbackRegion = page.getByRole("region", { name: "身体反馈" });
    await expect(
      feedbackRegion.getByText(safety === "yellow" ? "黄灯" : "红灯"),
    ).toBeVisible();
    await expect(
      feedbackRegion.getByRole("link", { name: "再次反馈" }),
    ).toBeVisible();
    await expect(feedbackRegion.getByText("告诉康复助手")).toHaveCount(0);
    await page.screenshot({
      path: `test-results/ui-r9-today-${safety}-390.png`,
      fullPage: true,
    });
  }

  activeToday = todayR9ChineseFixture;
  let release!: () => void;
  const syncResponseReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/trackers/knee-rehab/integrations/sync-latest",
    async (route) => {
      await syncResponseReleased;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sources: [
            {
              source: "garmin_activity",
              status: "records",
              recordCount: 1,
              continueAvailable: true,
            },
            {
              source: "garmin_wellness",
              status: "temporarily_failed",
              recordCount: 0,
              continueAvailable: false,
            },
            {
              source: "xunji_training",
              status: "needs_credentials",
              recordCount: 0,
              continueAvailable: false,
            },
          ],
        }),
      });
    },
  );
  await page.goto("/");
  const sync = page.getByRole("button", { name: "同步外部训练记录" });
  await sync.click();
  await expect(
    page.getByRole("button", { name: "正在同步外部训练记录" }),
  ).toBeDisabled();
  await expect(page.getByText("正在同步外部训练记录")).toBeVisible();
  await page.screenshot({
    path: "test-results/ui-r9-today-sync-running-390.png",
    fullPage: true,
  });
  release();
  await expect(page.getByText("已更新 1 条，部分来源未完成")).toBeVisible();
  await page.screenshot({
    path: "test-results/ui-r9-today-sync-partial-final-390.png",
    fullPage: true,
  });
});

for (const width of [320, 375, 390, 393, 430]) {
  test(`UI-R9 Chinese density and toolbar fit hold at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      trendsAggregate,
      { today: todayR9ChineseFixture },
    );
    await page.goto("/");
    await expect(page.getByText("上肢综合训练", { exact: true })).toHaveCount(
      1,
    );

    await page.getByRole("button", { name: "收起 上肢综合训练" }).click();
    const collapsed = await page.evaluate(() => ({
      workoutHeight:
        document
          .querySelector<HTMLElement>("[data-today-workout]")
          ?.getBoundingClientRect().height ?? 0,
      feedbackHeight:
        document
          .querySelector<HTMLElement>("[data-today-feedback]")
          ?.getBoundingClientRect().height ?? 0,
    }));
    expect(collapsed.workoutHeight).toBeLessThanOrEqual(220);
    expect(collapsed.feedbackHeight).toBeLessThanOrEqual(88);

    await page.getByRole("button", { name: "展开 上肢综合训练" }).click();
    const expanded = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>(
          ".today-prescription .ak-list-row",
        ),
      ];
      const sync = document.querySelector<HTMLElement>(".today-sync-button");
      const syncStyle = sync ? getComputedStyle(sync) : null;
      return {
        rowHeights: rows.map((row) => row.getBoundingClientRect().height),
        syncWidth: sync?.getBoundingClientRect().width ?? 0,
        syncGap: Number.parseFloat(syncStyle?.gap ?? "-1"),
        toolbarVariant: [
          ...document.querySelectorAll<HTMLElement>(
            "[data-ak-toolbar-variant]",
          ),
        ].map((element) => element.dataset.akToolbarVariant),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(expanded.rowHeights).toHaveLength(4);
    expect(
      expanded.rowHeights.every((height) => height >= 56 && height <= 64),
    ).toBe(true);
    expect(expanded.syncWidth).toBeLessThanOrEqual(92);
    expect(expanded.syncGap).toBeGreaterThanOrEqual(6);
    expect(expanded.syncGap).toBeLessThanOrEqual(8);
    expect(expanded.toolbarVariant).toEqual(["tonal", "tonal"]);
    expect(expanded.overflow).toBe(false);
  });
}

for (const width of [320, 375, 390, 393, 430]) {
  test(`anonymous mobile layout audit passes at ${width}px`, async ({
    page,
  }) => {
    let activeToday: unknown = todayAggregate;
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      trendsAggregate,
      { today: () => activeToday },
    );

    const inspectToday = async (
      aggregate: unknown,
      expectedText: string | RegExp,
    ) => {
      activeToday = aggregate;
      await page.goto("/");
      await expect(page.getByText(expectedText).first()).toBeVisible();
      await expectMobileLayoutIntegrity(page);
    };

    await inspectToday(todayAggregate, "Anonymous task");
    await expectTodayR9VisualContract(page, "Anonymous task");
    await inspectToday(
      {
        ...todayAggregate,
        day: {
          ...day,
          state: "not_started",
          startDate: nextLocalDate,
          tasks: [],
          externalTrainingRecords: [],
        },
      },
      /计划将于/,
    );
    await inspectToday(
      {
        ...todayAggregate,
        day: { ...day, tasks: [], externalTrainingRecords: [] },
      },
      "今天没有安排训练",
    );
    for (const safety of ["green", "yellow", "red"] as const) {
      await inspectToday(
        {
          ...todayAggregate,
          day: {
            ...day,
            feedbackCount: 1,
            feedbacks: [anonymousFeedback(safety)],
          },
        },
        safety === "green"
          ? "今日已记录 1 次"
          : safety === "yellow"
            ? "今天不要升级"
            : "停止相关诱发负荷",
      );
    }

    activeToday = todayAggregate;
    await page.goto("/");
    await page.getByRole("button", { name: "调整今天" }).click();
    await expect(page.locator("#today-adjustments")).toBeVisible();
    await expectMobileLayoutIntegrity(page);

    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByText("当前离线").first()).toBeVisible();
    await expectMobileLayoutIntegrity(page);
    await page.context().setOffline(false);

    for (const path of [
      "/calendar",
      "/plan",
      "/settings",
      "/settings/garmin",
      "/settings/xunji",
      "/settings/history",
      "/settings/deepseek",
      "/settings/backup",
      "/settings/storage",
      "/settings/account",
      "/feedback",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expectMobileLayoutIntegrity(page);
    }
  });
}

test("integration details keep enabled and disabled actions visually distinct", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPrivateReads(page, 0);
  await page.goto("/settings/garmin");
  await expect(page.locator(".integration-card")).toBeVisible();

  const garmin = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".integration-card");
    const enabled = document
      .getElementById("garmin-sync-date")
      ?.parentElement?.querySelector<HTMLButtonElement>("button");
    const maintenance = document.querySelector<HTMLDetailsElement>(
      ".integration-maintenance",
    );
    const summary = maintenance?.querySelector<HTMLElement>("summary");
    if (!card || !enabled || !maintenance || !summary) return null;
    return {
      syncBeforeMaintenance: Boolean(
        enabled.compareDocumentPosition(maintenance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      maintenanceOpen: maintenance.open,
      summaryHeight: summary.getBoundingClientRect().height,
      enabled: {
        background: getComputedStyle(enabled).backgroundColor,
        border: getComputedStyle(enabled).borderColor,
        color: getComputedStyle(enabled).color,
        cursor: getComputedStyle(enabled).cursor,
      },
    };
  });
  expect(garmin).not.toBeNull();
  expect(garmin?.syncBeforeMaintenance).toBe(true);
  expect(garmin?.maintenanceOpen).toBe(false);
  expect(garmin?.summaryHeight).toBeGreaterThanOrEqual(44);
  expect(garmin?.enabled.cursor).toBe("pointer");

  for (const path of ["/settings/xunji", "/settings/deepseek"]) {
    await page.goto(path);
    await expect(page.locator(".integration-card")).toBeVisible();
    const disabled = await page.evaluate(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".integration-card button",
        ),
      ].find((candidate) => candidate.disabled);
      if (!button) return null;
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        color: style.color,
        cursor: style.cursor,
        disabled: button.disabled,
      };
    });
    expect(disabled).not.toBeNull();
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.cursor).toBe("not-allowed");
    expect(disabled?.background).not.toBe(garmin?.enabled.background);
    expect(disabled?.border).not.toBe(garmin?.enabled.border);
    expect(disabled?.color).not.toBe(garmin?.enabled.color);
  }
});

for (const width of [320, 375, 390, 430]) {
  test(`manual evaluation decision confirmation fits a ${width}px mobile viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0, planAdvice, evaluationDecisionAggregate);
    await page.goto("/plan/evaluation");

    await page.getByLabel("这一周").selectOption("effective");
    await page.getByLabel("下一步").selectOption("maintain");
    await page.getByRole("button", { name: "检查你的选择" }).click();

    await expect(
      page.getByRole("heading", { name: "确认训练周和下一步" }),
    ).toBeVisible();
    const layout = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        ".evaluation-decision-confirmation",
      );
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".evaluation-decision-confirmation button",
        ),
      ];
      const cardRect = card?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardLeft: cardRect?.left ?? -1,
        cardRight: cardRect?.right ?? Number.POSITIVE_INFINITY,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return { height: rect.height, left: rect.left, right: rect.right };
        }),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.controls.every(
        ({ height, left, right }) =>
          height >= 44 && left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`trend summaries remain accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/plan/review");

    await expect(
      page.getByRole("heading", { name: "完成 1/2（50%）" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "最近八周趋势" }),
    ).toBeVisible();
    await expect(page.locator(".trend-series-row")).toHaveCount(8);
    await expect(page.getByText(/缺失记录不会按 0 计算/)).toBeVisible();
    await expect(page.getByText("查看数据覆盖与说明")).toBeVisible();
    await expect(page.getByText("更多")).toBeVisible();

    const layout = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".trend-refresh-button, .trend-details summary, .trend-more-actions summary",
        ),
      ];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return { height: rect.height, left: rect.left, right: rect.right };
        }),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.controls.every(
        ({ height, left, right }) =>
          height >= 44 && left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`empty trends and quiet calendar stay accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      emptyTrendsAggregate,
    );
    await page.goto("/plan/review");

    await expect(
      page.getByRole("heading", { name: "还没有可回顾的趋势" }),
    ).toBeVisible();
    await expect(page.locator(".trend-series-row")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "回到今天" })).toBeVisible();

    await page.goto("/calendar");
    await expect(page.getByText(/计划 v\d/)).toHaveCount(0);
    await expect(page.locator(".calendar-legend")).toHaveCount(0);
    const calendarDay = page.getByRole("button", {
      name: new RegExp(`^${localDate}，`),
    });
    await expect(calendarDay).toBeVisible();

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dayHeight: document
        .querySelector<HTMLElement>(".calendar-day:not(.empty)")
        ?.getBoundingClientRect().height,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.dayHeight).toBeGreaterThanOrEqual(44);
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`plan workspace and assistant details fit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);

    for (const path of [
      "/plan",
      "/plan/conversation",
      "/plan/profile",
      "/plan/memories",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      if (path === "/plan") {
        await expect(page.getByLabel("训练、身体感受或计划问题")).toBeVisible();
        await expect(
          page.getByRole("link", { name: "打开完整对话" }),
        ).toBeVisible();
        await expect(page.getByText("Anonymous next training")).toBeVisible();
        await expect(page.getByText(/第 5 周 ·/)).toHaveCount(0);
        await expect(page.getByText("当前目标")).toHaveCount(0);
        await expect(
          page.getByText(/日历周|不等于|正式康复计划从|每个计划周/),
        ).toHaveCount(0);
        await expect(page.getByText("版本 1", { exact: true })).toHaveCount(0);
      }
      await expectMobileLayoutIntegrity(page);
    }
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`plan advice steps stay compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0, emptyPlanAdvice);
    await page.route(
      "**/api/trackers/knee-rehab/ai-analysis",
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.fulfill({ status: 200, json: planAdvice });
      },
    );

    const expectCompactState = async (cardSelector: string) => {
      const layout = await page.locator(cardSelector).evaluate((card) => {
        const cardRect = card.getBoundingClientRect();
        const buttons = [
          ...card.querySelectorAll<HTMLButtonElement>("button"),
        ].filter((button) => button.getClientRects().length > 0);
        return {
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          cardLeft: cardRect.left,
          cardRight: cardRect.right,
          buttons: buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              height: rect.height,
              left: rect.left,
              right: rect.right,
            };
          }),
        };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
      expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.buttons.length).toBeGreaterThan(0);
      expect(
        layout.buttons.every(
          ({ height, left, right }) =>
            height >= 44 &&
            height <= 64 &&
            left >= layout.cardLeft &&
            right <= layout.cardRight,
        ),
      ).toBe(true);
    };

    await page.goto("/plan/advice");
    const prepare = page.getByRole("button", {
      name: "查看本次分析内容",
    });
    await expect(prepare).toBeVisible();
    await expectCompactState(".plan-advice-intro");

    await prepare.click();
    await expect(
      page.getByRole("heading", { name: "本次分析上下文" }),
    ).toBeVisible();
    const confirm = page.getByRole("button", { name: "确认并生成建议" });
    await expect(confirm).toBeVisible();
    await expectCompactState(".plan-advice-context-preview");

    await confirm.click();
    await expect(page.getByRole("button", { name: "正在分析…" })).toBeVisible();
    await expectCompactState(".plan-advice-context-preview");

    await expect(
      page.getByRole("heading", { name: "Anonymous future adjustment" }),
    ).toBeVisible();
    await expectCompactState(".plan-advice-result");
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`plan rollback confirmation remains accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0, rollbackAdvice);
    await page.goto("/plan/advice");

    const rollback = page.getByRole("button", {
      name: "撤销这次计划更新",
    });
    await expect(rollback).toBeVisible();
    await rollback.click();
    await expect(
      page.getByRole("group", { name: "确认撤销并创建新版本？" }),
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".plan-advice-page button, .plan-advice-page a",
        ),
      ];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return { height: rect.height, left: rect.left, right: rect.right };
        }),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.controls.every(
        ({ height, left, right }) =>
          height >= 44 && left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
  });
}

async function measureTabClick(
  page: Page,
  href: string,
  visibleSelector: string,
) {
  await page.evaluate((targetHref) => {
    const state = window as typeof window & {
      __akNavigationStartedAt?: number;
    };
    const link = document.querySelector<HTMLAnchorElement>(
      `nav[aria-label="主导航"] a[href="${targetHref}"]`,
    );
    if (!link) throw new Error(`missing tab ${targetHref}`);
    link.addEventListener(
      "click",
      () => {
        state.__akNavigationStartedAt = performance.now();
      },
      { once: true },
    );
  }, href);
  await page.locator(`nav[aria-label="主导航"] a[href="${href}"]`).click();
  await page.waitForFunction((selector) => {
    const element = document.querySelector<HTMLElement>(selector);
    return Boolean(element && element.getClientRects().length > 0);
  }, visibleSelector);
  return page.evaluate(() => {
    const state = window as typeof window & {
      __akNavigationStartedAt?: number;
    };
    if (state.__akNavigationStartedAt === undefined) {
      throw new Error("missing navigation start mark");
    }
    return performance.now() - state.__akNavigationStartedAt;
  });
}

async function expectActiveTab(
  page: Page,
  href: string,
  expectedPathname: string,
  expectedSearch = "",
) {
  const link = page.locator(`nav[aria-label="主导航"] a[href="${href}"]`);
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        pathname: window.location.pathname,
        search: window.location.search,
      })),
    )
    .toEqual({ pathname: expectedPathname, search: expectedSearch });
}

test.beforeEach(async ({ context }) => {
  await authorize(context);
});

for (const width of [320, 375, 390, 430]) {
  test(`evaluation confirmation fits a ${width}px mobile viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const counters = await mockPrivateReads(page, 0);
    await page.goto("/plan/evaluation");

    await page.getByLabel("左侧反应").selectOption("mild");
    await page.getByLabel("右侧反应").selectOption("moderate");
    await page
      .getByLabel("补充说明（可选）")
      .fill("Anonymous mobile confirmation note");
    await page.getByRole("button", { name: "检查评估结果" }).click();

    await expect(
      page.getByRole("heading", { name: "确认评估结果" }),
    ).toBeVisible();
    await expect(page.getByText(/确认保存后不能修改/)).toBeVisible();
    expect(counters.evaluation).toBe(1);

    const layout = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        ".evaluation-result-confirmation",
      );
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".evaluation-result-confirmation button",
        ),
      ];
      const cardRect = card?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardLeft: cardRect?.left ?? -1,
        cardRight: cardRect?.right ?? Number.POSITIVE_INFINITY,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return { height: rect.height, left: rect.left, right: rect.right };
        }),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.controls.every(
        ({ height, left, right }) =>
          height >= 44 && left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`plan decision preview remains accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/plan/advice");

    await expect(
      page.getByRole("heading", { name: "训练调整建议" }),
    ).toBeVisible();
    await expect(
      page.getByText("Anonymous adjusted task with a long mobile title"),
    ).toBeVisible();
    const accept = page.getByRole("button", { name: "接受并更新计划" });
    await expect(accept).toBeVisible();
    await accept.click();
    await expect(
      page.getByRole("group", { name: "确认更新后续计划？" }),
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".plan-advice-page button, .plan-advice-page a",
        ),
      ];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return { height: rect.height, left: rect.left, right: rect.right };
        }),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.controls.every(
        ({ height, left, right }) =>
          height >= 44 && left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [320, 375, 390, 430]) {
  test(`settings list and detail entry fit a ${width}px mobile viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: /Garmin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /训记/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /历史数据补录/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /DeepSeek/ })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /GitHub 数据备份/ }),
    ).toBeVisible();
    await expect(page.locator("[data-settings-shell] input")).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(".settings-row"),
      ];
      const rows = [...document.querySelectorAll<HTMLElement>(".settings-row")];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          const groupRect = control
            .closest<HTMLElement>(".settings-list-group")
            ?.getBoundingClientRect();
          return {
            height: rect.height,
            left: rect.left,
            right: rect.right,
            groupLeft: groupRect?.left ?? 0,
            groupRight: groupRect?.right ?? 0,
          };
        }),
        rows: rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.rows.every(
        ({ left, right }) => left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
    expect(
      layout.controls.every(
        ({ height, left, right, groupLeft, groupRight }) =>
          height >= 44 && left >= groupLeft && right <= groupRight,
      ),
    ).toBe(true);

    await page.getByRole("link", { name: /历史数据补录/ }).click();
    await expect(page.getByLabel("补录范围")).toHaveValue("14");
    const visibleHistoryCard = page.locator(".history-sync-card:visible");
    await expect(
      visibleHistoryCard.getByText(`${historyRangeFrom} 至 ${localDate}`),
    ).toBeVisible();
    const recordLink = visibleHistoryCard
      .locator(".history-sync-record-dates")
      .first()
      .getByRole("link", {
        name: new RegExp(`${historyRecordDate}.*Garmin 活动.*睡眠与步数`),
      });
    await expect(recordLink).toBeVisible();
    const historyLayout = await page.evaluate(() => {
      const card = [
        ...document.querySelectorAll<HTMLElement>(".history-sync-card"),
      ].find((candidate) => candidate.getBoundingClientRect().width > 0);
      const controls = card
        ? [
            ...card.querySelectorAll<HTMLElement>(
              "select, button, .history-sync-record-dates a",
            ),
          ]
        : [];
      const rect = card?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardLeft: rect?.left ?? -1,
        cardRight: rect?.right ?? Number.POSITIVE_INFINITY,
        controls: controls.map((control) => {
          const controlRect = control.getBoundingClientRect();
          return {
            height: controlRect.height,
            left: controlRect.left,
            right: controlRect.right,
          };
        }),
      };
    });
    expect(historyLayout.scrollWidth).toBeLessThanOrEqual(
      historyLayout.clientWidth,
    );
    expect(historyLayout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(historyLayout.cardRight).toBeLessThanOrEqual(
      historyLayout.clientWidth,
    );
    expect(
      historyLayout.controls.every(
        ({ height, left, right }) =>
          height >= 44 && left >= 0 && right <= historyLayout.clientWidth,
      ),
      JSON.stringify(historyLayout.controls),
    ).toBe(true);

    await recordLink.click();
    await expect(page).toHaveURL(`/calendar?date=${historyRecordDate}`);
    const selectedHistoryDay = page.getByRole("button", {
      name: new RegExp(`^${historyRecordDate}，已选中`),
    });
    await expect(selectedHistoryDay).toBeVisible();
    await expect(selectedHistoryDay).toBeFocused();
    await expect(
      page.getByRole("region", { name: "外部活动与训练记录" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL("/settings/history");
    await page.goForward();
    await expect(page).toHaveURL(`/calendar?date=${historyRecordDate}`);
    await expect(selectedHistoryDay).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page).toHaveURL(`/calendar?date=${historyRecordDate}`);
    await expect(selectedHistoryDay).toHaveAttribute("aria-pressed", "true");

    await page.goto("/settings");
    await page.getByRole("link", { name: /Garmin/ }).click();
    await expect(
      page
        .getByRole("main", { name: "Garmin设置" })
        .getByRole("heading", { name: "Garmin", level: 1 }),
    ).toBeVisible();
    const garminSettings = page.getByRole("main", { name: "Garmin设置" });
    await expect(garminSettings.locator("#garmin-token-file")).toHaveCount(1);
    await expect(
      garminSettings.getByRole("button", { name: "导入并加密保存" }),
    ).not.toBeVisible();
    await expect(
      garminSettings.getByRole("group", { name: "连接维护" }),
    ).toBeVisible();

    await page.goto("/");
    await expect(page.getByText("3.00 km")).toBeVisible();
    const activityLayout = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-tab-panel="today"] .external-training-card',
      );
      const rect = card?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        left: rect?.left ?? -1,
        right: rect?.right ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(activityLayout.scrollWidth).toBeLessThanOrEqual(
      activityLayout.clientWidth,
    );
    expect(activityLayout.left).toBeGreaterThanOrEqual(0);
    expect(activityLayout.right).toBeLessThanOrEqual(
      activityLayout.clientWidth,
    );
  });
}

test("history link retargets an already visited persistent calendar", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto(`/calendar?date=${localDate}`);
  await expect(
    page.getByRole("button", { name: new RegExp(`^${localDate}，已选中`) }),
  ).toBeVisible();

  await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("link", { name: /历史数据补录/ }).click();
  const historyCard = page.locator(".history-sync-card:visible");
  await historyCard
    .locator(".history-sync-record-dates")
    .first()
    .getByRole("link", { name: new RegExp(`^${historyRecordDate}`) })
    .click();

  await expect(page).toHaveURL(`/calendar?date=${historyRecordDate}`);
  const selected = page.getByRole("button", {
    name: new RegExp(`^${historyRecordDate}，已选中`),
  });
  await expect(selected).toBeVisible();
  await expect(selected).toBeFocused();
  await expect(
    page.getByRole("region", { name: "外部活动与训练记录" }),
  ).toBeVisible();
});

test("settings detail return restores the cached settings list", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

  await page.getByRole("link", { name: /账号/ }).click();
  await expect(page.getByRole("heading", { name: "账号" })).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/account");

  await page.getByRole("link", { name: "返回" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.locator(".settings-row")).toHaveCount(7);
  await expectActiveTab(page, "/settings", "/settings");
});

test("direct settings detail return restores the root settings list", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "账号" })).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/account");

  await page.getByRole("link", { name: "返回" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.locator(".settings-row")).toHaveCount(7);
  await expectActiveTab(page, "/settings", "/settings");
});

test("settings detail return keeps browser back and forward aligned", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/settings");
  await page.getByRole("link", { name: /Garmin/ }).click();
  await expect(
    page
      .getByRole("main", { name: "Garmin设置" })
      .getByRole("heading", { name: "Garmin", level: 1 }),
  ).toBeVisible();

  await page.getByRole("link", { name: "返回" }).click();
  await expect(page.locator(".settings-row")).toHaveCount(7);
  await expectActiveTab(page, "/settings", "/settings");

  await page.goBack();
  await expect(
    page
      .getByRole("main", { name: "Garmin设置" })
      .getByRole("heading", { name: "Garmin", level: 1 }),
  ).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/garmin");

  await page.goForward();
  await expect(page.locator(".settings-row")).toHaveCount(7);
  await expectActiveTab(page, "/settings", "/settings");
});

const pendingSettingsEscapes = [
  {
    width: 320,
    detailPath: "/settings/garmin",
    detailName: /Garmin/,
    rootHref: "/",
    rootName: /今日/,
    rootSelector: '[data-tab-panel="today"] .today-task-summary',
    settleDelayMs: 0,
  },
  {
    width: 375,
    detailPath: "/settings/history",
    detailName: /历史数据补录/,
    rootHref: "/calendar",
    rootName: /日历/,
    rootSelector: '[data-tab-panel="calendar"] .calendar-shell',
    settleDelayMs: 20,
  },
  {
    width: 390,
    detailPath: "/settings/deepseek",
    detailName: /DeepSeek/,
    rootHref: "/plan",
    rootName: /计划/,
    rootSelector: '[data-tab-panel="plan"] .plan-workspace-page',
    settleDelayMs: 60,
  },
  {
    width: 430,
    detailPath: "/settings/account",
    detailName: /账号/,
    rootHref: "/",
    rootName: /今日/,
    rootSelector: '[data-tab-panel="today"] .today-task-summary',
    settleDelayMs: 120,
  },
] as const;

for (const scenario of pendingSettingsEscapes) {
  test(`the later ${scenario.rootHref} intent wins a pending ${scenario.detailPath} navigation at ${scenario.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await mockPrivateReads(page, 0);
    let releaseDetail!: () => void;
    const detailReleased = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    let markDetailStarted!: () => void;
    const detailStarted = new Promise<void>((resolve) => {
      markDetailStarted = resolve;
    });
    let heldRequestCount = 0;
    await page.route(`**${scenario.detailPath}?*`, async (route) => {
      const request = route.request();
      const headers = request.headers();
      if (
        request.method() !== "GET" ||
        headers.rsc !== "1" ||
        headers["next-router-prefetch"] === "1" ||
        headers["next-router-segment-prefetch"] !== undefined
      ) {
        await route.continue();
        return;
      }
      heldRequestCount += 1;
      markDetailStarted();
      await detailReleased;
      await route.continue();
    });

    await page.goto("/settings");
    await expect(page.locator(".settings-row")).toHaveCount(7);

    const detailClick = page
      .getByRole("link", { name: scenario.detailName })
      .click();
    await detailStarted;
    if (scenario.settleDelayMs > 0) {
      await page.waitForTimeout(scenario.settleDelayMs);
    }
    await page.getByRole("link", { name: scenario.rootName }).click();
    await expect(page.locator(scenario.rootSelector)).toBeVisible();
    await expectActiveTab(page, scenario.rootHref, scenario.rootHref);

    releaseDetail();
    await detailClick;
    expect(heldRequestCount).toBeGreaterThan(0);
    await expect(page.locator(scenario.rootSelector)).toBeVisible();
    await expectActiveTab(page, scenario.rootHref, scenario.rootHref);
    await expect(page.locator(".settings-detail-page:visible")).toHaveCount(0);

    await page.getByRole("link", { name: /设置/ }).click();
    await expect(page.locator(".settings-row:visible")).toHaveCount(7);
    await expectActiveTab(page, "/settings", "/settings");
  });
}

for (const width of [320, 375, 390, 393, 430]) {
  test(`UI-R7 Apple Fitness layout contract stays inside the viewport at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/");
    await expect(page.locator("[data-today-workout]")).toBeVisible();
    await expectMobileLayoutIntegrity(page);

    const contract = await page.evaluate(() => {
      const root = document.documentElement;
      const workout = document.querySelector<HTMLElement>(
        "[data-today-workout]",
      );
      const records = document.querySelector<HTMLElement>(
        "[data-today-records]",
      );
      const feedback = document.querySelector<HTMLElement>(
        "[data-today-feedback]",
      );
      const nav = document.querySelector<HTMLElement>(".bottom-nav");
      const content = document.querySelector<HTMLElement>(
        "[data-app-shell-content]",
      );
      const nestedSurface = Boolean(
        document.querySelector(
          ".today-task .surface-card, .today-task .today-section",
        ),
      );
      const navRect = nav?.getBoundingClientRect();
      const lastControl = [
        ...document.querySelectorAll<HTMLElement>(
          "main button, main a[href], main summary",
        ),
      ].at(-1);
      const lastRect = lastControl?.getBoundingClientRect();
      return {
        background: getComputedStyle(root)
          .getPropertyValue("--ak-background")
          .trim(),
        gutter: getComputedStyle(
          document.querySelector<HTMLElement>(".app-shell")!,
        ).paddingLeft,
        order: [workout, records, feedback].map((node) =>
          node?.getAttribute("aria-label"),
        ),
        siblings: Boolean(
          workout &&
          records &&
          feedback &&
          workout.parentElement === records.parentElement &&
          records.parentElement === feedback.parentElement,
        ),
        nestedSurface,
        navCoversLastControl: Boolean(
          navRect &&
          lastRect &&
          lastRect.bottom > navRect.top &&
          lastRect.top < navRect.bottom &&
          content?.scrollHeight === content?.clientHeight,
        ),
      };
    });

    expect(contract.background).toBe("#f2f2f7");
    expect(Number.parseFloat(contract.gutter)).toBeGreaterThanOrEqual(20);
    expect(Number.parseFloat(contract.gutter)).toBeLessThanOrEqual(32);
    expect(contract.order).toEqual(["今日训练", "训练记录", "身体反馈"]);
    expect(contract.siblings).toBe(true);
    expect(contract.nestedSurface).toBe(false);
    expect(contract.navCoversLastControl).toBe(false);
  });
}

test("UI-R7 final cascade keeps token-backed styles after legacy rules", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/");
  await expect(page.locator("[data-today-workout]")).toBeVisible();

  const cascade = await page.evaluate(() => {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const probe = document.createElement("div");
    probe.style.background = "var(--ak-material-background)";
    probe.style.boxShadow = "var(--ak-material-shadow)";
    document.body.append(probe);
    const probeStyle = getComputedStyle(probe);
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const title = document.querySelector<HTMLElement>(
      ".ak-screen-header-copy h1",
    );
    const surfaces = [
      ...document.querySelectorAll<HTMLElement>(".today-section, .today-task"),
    ];
    const navStyle = nav ? getComputedStyle(nav) : null;
    const titleStyle = title ? getComputedStyle(title) : null;
    const materialBackground = probeStyle.backgroundColor;
    const materialShadow = probeStyle.boxShadow;
    const surfaceBackground = rootStyle.getPropertyValue("--ak-surface").trim();
    const tokenShadow = rootStyle
      .getPropertyValue("--ak-material-shadow")
      .trim();
    probe.remove();
    return {
      navBackground: navStyle?.backgroundColor,
      navShadow: navStyle?.boxShadow,
      materialBackground,
      materialShadow,
      titleSize: titleStyle?.fontSize,
      surfaceBackground,
      surfaces: surfaces.map(
        (surface) => getComputedStyle(surface).backgroundColor,
      ),
      tokenShadow,
    };
  });

  expect(cascade.navBackground).toBe(cascade.materialBackground);
  expect(cascade.navShadow).toBe(cascade.materialShadow);
  expect(cascade.navBackground).not.toBe("rgba(244, 246, 242, 0.96)");
  expect(cascade.titleSize).toBe("34px");
  expect(cascade.surfaces).toEqual(
    cascade.surfaces.map(() => "rgb(255, 255, 255)"),
  );
  expect(cascade.surfaceBackground).toBe("#fff");
  expect(cascade.tokenShadow).toContain("24px");
});

for (const rootPage of [
  {
    path: "/",
    heading: ".ak-screen-header-copy h1",
    surface: ".today-section",
    backgroundToken: "--ak-surface",
  },
  {
    path: "/calendar",
    heading: ".calendar-topbar h1",
    surface: ".calendar-card",
    backgroundToken: "--ak-surface",
  },
  {
    path: "/plan",
    heading: ".trend-page-header h1",
    surface: ".plan-workspace-summary",
    backgroundToken: "--ak-accent",
  },
  {
    path: "/settings",
    heading: ".settings-shell .topbar h1",
    surface: ".settings-list-group",
    backgroundToken: "--ak-surface",
  },
] as const) {
  test(`UI-R7 final token cascade covers ${rootPage.path}`, async ({
    page,
  }) => {
    await mockPrivateReads(page, 0);
    await page.goto(rootPage.path);
    await expect(page.locator(rootPage.heading)).toBeVisible();
    await expect(page.locator(rootPage.surface).first()).toBeVisible();

    const values = await page.evaluate(
      ({ heading, surface, backgroundToken }) => {
        const rootStyle = getComputedStyle(document.documentElement);
        const probe = document.createElement("div");
        probe.style.background = `var(${backgroundToken})`;
        document.body.append(probe);
        const probeBackground = getComputedStyle(probe).backgroundColor;
        const header = document.querySelector<HTMLElement>(heading);
        const surfaceElement = document.querySelector<HTMLElement>(surface);
        const nav = document.querySelector<HTMLElement>(".bottom-nav");
        const navStyle = nav ? getComputedStyle(nav) : null;
        const navProbe = document.createElement("div");
        navProbe.style.background = "var(--ak-material-background)";
        document.body.append(navProbe);
        const navProbeBackground = getComputedStyle(navProbe).backgroundColor;
        const result = {
          headerSize: header ? getComputedStyle(header).fontSize : null,
          surfaceBackground: surfaceElement
            ? getComputedStyle(surfaceElement).backgroundColor
            : null,
          probeBackground,
          navBackground: navStyle?.backgroundColor ?? null,
          navProbeBackground,
          titleToken: rootStyle.getPropertyValue("--ak-title-size").trim(),
        };
        probe.remove();
        navProbe.remove();
        return result;
      },
      rootPage,
    );

    expect(values.headerSize).toBe("34px");
    expect(values.titleToken).toBe("34px");
    expect(values.surfaceBackground).toBe(values.probeBackground);
    expect(values.navBackground).toBe(values.navProbeBackground);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`UI-R7 Plan next-training Hero has visible contrast in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await mockPrivateReads(page, 0);
    await page.goto("/plan");
    const hero = page.locator(".plan-workspace-summary");
    await expect(hero).toBeVisible();
    await expect(hero.getByText("下一次训练", { exact: true })).toBeVisible();
    await expect(
      hero.getByText("Anonymous next training", { exact: true }),
    ).toBeVisible();

    const contrast = await hero.evaluate((element) => {
      const heroStyle = getComputedStyle(element);
      const heading = element.querySelector<HTMLElement>("h2");
      const copy = element.querySelector<HTMLElement>("p");
      const headingStyle = heading ? getComputedStyle(heading) : null;
      const copyStyle = copy ? getComputedStyle(copy) : null;
      const headingRect = heading?.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      return {
        background: heroStyle.backgroundColor,
        headingColor: headingStyle?.color,
        copyColor: copyStyle?.color,
        headingText: heading?.textContent,
        headingVisible: Boolean(
          headingRect && headingRect.width > 0 && headingRect.height > 0,
        ),
        copyVisible: Boolean(
          copyRect && copyRect.width > 0 && copyRect.height > 0,
        ),
      };
    });

    expect(contrast.background).not.toBe("rgb(255, 255, 255)");
    expect(contrast.background).not.toBe(contrast.headingColor);
    expect(contrast.background).not.toBe(contrast.copyColor);
    expect(contrast.headingText).toContain("项训练");
    expect(contrast.headingVisible).toBe(true);
    expect(contrast.copyVisible).toBe(true);
  });
}

test("UI-R7 captures anonymous 390x844 root-page review screenshots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPrivateReads(page, 0);
  const pages = [
    ["today", "/", "[data-today-workout]"],
    ["calendar", "/calendar", ".calendar-shell"],
    ["plan", "/plan", ".plan-workspace-page"],
    ["settings", "/settings", ".settings-shell"],
  ] as const;

  for (const [name, path, selector] of pages) {
    await page.goto(path);
    await expect(page.locator(selector).first()).toBeVisible();
    if (name === "plan") {
      const planHero = page.locator(".plan-workspace-summary");
      await expect(
        planHero.getByText("下一次训练", { exact: true }),
      ).toBeVisible();
      await expect(
        planHero.getByText("Anonymous next training", { exact: true }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: `/private/tmp/ak22ak-ui-r7-${name}-390x844.png`,
      fullPage: false,
    });
  }
});

test("UI-R7 Calendar keeps task descriptions behind the existing secondary disclosure", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/calendar");
  await expect(page.locator(".calendar-task")).toHaveCount(1);

  await expect(page.getByText("匿名模板说明", { exact: true })).toHaveCount(0);
  const disclosure = page.getByRole("button", { name: "查看当天计划" });
  await expect(disclosure).toHaveCount(1);
  await disclosure.click();
  await expect(page.getByText("匿名模板说明", { exact: true })).toBeVisible();
});

for (const safetyLevel of ["yellow", "red"] as const) {
  test(`UI-R7 ${safetyLevel} safety remains before workout content`, async ({
    page,
  }) => {
    const unsafeToday = structuredClone(todayAggregate);
    unsafeToday.day.feedbackCount = 1;
    unsafeToday.day.feedbacks = [anonymousFeedback(safetyLevel)] as never[];
    await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      trendsAggregate,
      {
        today: unsafeToday,
      },
    );
    await page.goto("/");
    await expect(
      page.getByRole("alert", {
        name: new RegExp(`${safetyLevel === "red" ? "红灯" : "黄灯"}安全提示`),
      }),
    ).toBeVisible();

    const order = await page.evaluate(() => {
      const safety = document.querySelector<HTMLElement>(".safety-banner");
      const workout = document.querySelector("[data-today-workout]");
      if (!safety || !workout) {
        return { followsWorkout: false, background: null, color: null };
      }
      const style = getComputedStyle(safety);
      return {
        followsWorkout: Boolean(
          safety.compareDocumentPosition(workout) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        background: style.backgroundColor,
        color: style.color,
      };
    });
    expect(order.followsWorkout).toBe(true);
    expect(order.background).not.toBe("rgb(255, 255, 255)");
    expect(order.background).not.toBe(order.color);
  });
}

test("a loaded settings error cannot cover a later Today intent", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.route(
    "**/api/trackers/knee-rehab/integrations/deepseek/credential",
    async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    },
  );
  await page.goto("/settings/deepseek");
  await expect(page.locator(".settings-detail-error")).toContainText(
    "暂时无法加载",
  );

  await page.getByRole("link", { name: /今日/ }).click();
  await expect(
    page.locator('[data-tab-panel="today"] .today-task-summary'),
  ).toBeVisible();
  await expectActiveTab(page, "/", "/");
  await expect(page.locator(".settings-detail-page:visible")).toHaveCount(0);
});

test("detail escape preserves a cached calendar query through back and forward", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto(`/calendar?date=${localDate}`);
  await expect(
    page.getByRole("button", { name: new RegExp(`^${localDate}，已选中`) }),
  ).toBeVisible();

  await page.getByRole("link", { name: /设置/ }).click();
  await page.getByRole("link", { name: /账号/ }).click();
  await expect(page.getByRole("heading", { name: "账号" })).toBeVisible();
  await page.getByRole("link", { name: /日历/ }).click();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "账号" })).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/account");
  await page.goForward();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${localDate}，已选中`) }),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);

  await page.getByRole("link", { name: /设置/ }).click();
  await expect(
    page.locator('[data-tab-panel="settings"] .settings-row'),
  ).toHaveCount(7);
  await expect(
    page.locator('[data-tab-panel="settings"] .calendar-shell'),
  ).toHaveCount(0);
  await expectActiveTab(page, "/settings", "/settings");
});

test("direct settings detail survives reload and returns from another root tab", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/settings/deepseek");
  const deepSeekHeading = page
    .getByRole("main", { name: "DeepSeek设置" })
    .getByRole("heading", { name: "DeepSeek", level: 1 });
  await expect(deepSeekHeading).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/deepseek");

  await page.reload();
  await expect(deepSeekHeading).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/deepseek");

  await page.getByRole("link", { name: /日历/ }).click();
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-shell'),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar");

  await page.getByRole("link", { name: /设置/ }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.locator(".settings-row")).toHaveCount(7);
  await expect(page.getByText("无需处理")).toHaveCount(0);
  await expectActiveTab(page, "/settings", "/settings");
});

test("cold uncached Calendar exposes a stable target shell within 100 ms", async ({
  page,
}) => {
  await mockPrivateReads(page, 800);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.locator('[data-app-shell-ready="true"]')).toBeVisible();

  const elapsed = await measureTabClick(
    page,
    "/calendar",
    '[data-tab-panel="calendar"] .calendar-shell',
  );
  expect(elapsed).toBeLessThan(100);
  await expect(page.getByText("正在加载当天详情…")).toBeVisible();
  await expect(page.getByText(/正在切换/)).toHaveCount(0);
});

test("warm Calendar and Settings list remains visible without aggregate refetch", async ({
  page,
}) => {
  const counters = await mockPrivateReads(page, 80);
  await page.goto("/");
  await expect(page.getByText("Anonymous task").first()).toBeVisible();
  await expect.poll(() => counters.month).toBe(1);
  await expect.poll(() => counters.day).toBe(1);
  await expect.poll(() => counters.integration).toBe(1);
  await expect(page.getByText("Anonymous task").first()).toBeVisible();

  const calendarFirst = await measureTabClick(
    page,
    "/calendar",
    '[data-tab-panel="calendar"] .calendar-shell',
  );
  expect(calendarFirst).toBeLessThan(100);
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-task'),
  ).toBeVisible();
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('[data-tab-panel="calendar"] main')
      ?.style.setProperty("min-height", "3000px", "important");
    document
      .querySelector<HTMLElement>("[data-app-shell-content]")
      ?.scrollTo({ top: 320, behavior: "auto" });
  });
  const requestsAfterCalendar = { ...counters };

  const settingsFirst = await measureTabClick(
    page,
    "/settings",
    '[data-tab-panel="settings"] [data-settings-shell="true"]',
  );
  expect(settingsFirst).toBeLessThan(100);
  await expect(
    page.locator('[data-tab-panel="settings"] .settings-row'),
  ).toHaveCount(7);
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('[data-tab-panel="settings"] main')
      ?.style.setProperty("min-height", "3000px", "important");
    document
      .querySelector<HTMLElement>("[data-app-shell-content]")
      ?.scrollTo({ top: 640, behavior: "auto" });
  });

  const calendarReturn = await measureTabClick(
    page,
    "/calendar",
    '[data-tab-panel="calendar"] .calendar-task',
  );
  expect(calendarReturn).toBeLessThan(100);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLElement>("[data-app-shell-content]")
            ?.scrollTop,
      ),
    )
    .toBe(320);
  expect(counters).toEqual(requestsAfterCalendar);
  await expect(page.getByText(/正在切换/)).toHaveCount(0);

  const settingsReturn = await measureTabClick(
    page,
    "/settings",
    '[data-tab-panel="settings"] .settings-row',
  );
  expect(settingsReturn).toBeLessThan(100);
  await expect(
    page.locator('[data-tab-panel="settings"] .settings-row'),
  ).toHaveCount(7);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLElement>("[data-app-shell-content]")
            ?.scrollTop,
      ),
    )
    .toBe(640);
});

test("persistent tabs keep DOM, active state and browser history URLs aligned", async ({
  page,
}) => {
  await mockPrivateReads(page, 0);
  await page.goto("/");
  await expect(page.getByText("Anonymous task").first()).toBeVisible();
  await expectActiveTab(page, "/", "/");

  await page.getByRole("link", { name: /日历/ }).click();
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-shell'),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar");
  await page
    .getByRole("button", { name: new RegExp(`^${localDate}，`) })
    .click();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);

  await page.getByRole("link", { name: /设置/ }).click();
  await expect(page.getByRole("main", { name: "设置页面" })).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings");

  await page.getByRole("link", { name: /日历/ }).click();
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-shell'),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);

  await page.reload();
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-shell'),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);

  await page.getByRole("link", { name: /计划/ }).click();
  await expect(page.getByRole("main", { name: "计划页面" })).toBeVisible();
  await expectActiveTab(page, "/plan", "/plan");
  await page.getByRole("link", { name: /今日/ }).click();
  await expect(
    page.getByRole("button", { name: "收起 Anonymous task" }),
  ).toBeVisible();
  await expectActiveTab(page, "/", "/");

  await page.goBack();
  await expect(page.getByRole("main", { name: "计划页面" })).toBeVisible();
  await expectActiveTab(page, "/plan", "/plan");
  await page.goBack();
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-shell'),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);
  await page.goForward();
  await expect(page.getByRole("main", { name: "计划页面" })).toBeVisible();
  await expectActiveTab(page, "/plan", "/plan");
  await page.goForward();
  await expect(
    page.getByRole("button", { name: "收起 Anonymous task" }),
  ).toBeVisible();
  await expectActiveTab(page, "/", "/");
});

for (const width of [320, 375, 390, 430]) {
  test(`association feedback stays canonical across persistent tabs at ${width}px`, async ({
    page,
  }) => {
    const scenario = externalAssociationScenario();
    await page.setViewportSize({ width, height: 844 });
    const counters = await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      trendsAggregate,
      {
        today: scenario.today,
        day: scenario.selectedDay,
        association: scenario.associate,
      },
    );
    await page.goto("/");

    const todayPanel = page.locator('[data-tab-panel="today"]');
    await expect(todayPanel.getByLabel("外部活动与训练记录")).toBeVisible();
    await expect(todayPanel.getByRole("heading", { name: "步行" })).toHaveCount(
      1,
    );
    const taskCheckbox = todayPanel.getByRole("checkbox", {
      name: "Anonymous task",
    });
    await expect(taskCheckbox).not.toBeChecked();
    await expectMobileLayoutIntegrity(page);

    await todayPanel.getByRole("button", { name: "关联到此任务" }).click();
    await expect(
      todayPanel.getByText(
        "Garmin 活动已关联到“Anonymous task”；任务完成状态未改变，可在日历当天修改。",
      ),
    ).toBeVisible();
    await expect(todayPanel.getByText("已关联 1 条来源 · Garmin")).toHaveCount(
      0,
    );
    await expect(todayPanel.getByLabel("外部活动与训练记录")).toHaveCount(1);
    await expect(taskCheckbox).not.toBeChecked();
    await expect.poll(() => counters.association).toBe(1);

    await page.getByRole("link", { name: "日历", exact: true }).click();
    await expect(page).toHaveURL("/calendar");
    const calendarPanel = page.locator('[data-tab-panel="calendar"]');
    await expect(
      calendarPanel.getByText("已关联：Anonymous task"),
    ).toBeVisible();
    await expect(calendarPanel.getByText("已标记为与计划无关")).toBeVisible();
    await expect(calendarPanel.getByLabel("康复任务")).toHaveCount(0);
    await expect(
      calendarPanel.getByRole("button", { name: "修改关联" }),
    ).toHaveCount(2);
    await expectMobileLayoutIntegrity(page);

    await calendarPanel
      .getByRole("button", { name: "修改关联" })
      .first()
      .click();
    await expect(calendarPanel.getByLabel("康复任务")).toBeVisible();
    await expectMobileLayoutIntegrity(page);

    await page.goBack();
    await expect(page).toHaveURL("/");
    await expect(todayPanel.getByText("已关联 1 条来源 · Garmin")).toHaveCount(
      0,
    );
    await page.goForward();
    await expect(page).toHaveURL("/calendar");
    await expect(
      calendarPanel.getByText("已关联：Anonymous task"),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL("/calendar");
    await expect(
      page
        .locator('[data-tab-panel="calendar"]')
        .getByText("已关联：Anonymous task"),
    ).toBeVisible();
  });
}

test("calendar only offers return-to-today away from today and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPrivateReads(page, 0);
  await page.goto(`/calendar?date=${localDate}`);

  await expect(page.getByRole("button", { name: "回到今天" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "退出" })).toHaveCount(0);

  await page
    .getByRole("button", { name: new RegExp(`^${nextLocalDate}，`) })
    .click();
  await expectActiveTab(
    page,
    "/calendar",
    "/calendar",
    `?date=${nextLocalDate}`,
  );

  const returnToToday = page.getByRole("button", { name: "回到今天" });
  await expect(returnToToday).toBeVisible();
  await returnToToday.click();

  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);
  const todayButton = page.getByRole("button", {
    name: new RegExp(`^${localDate}，已选中，今天`),
  });
  await expect(todayButton).toHaveAttribute("aria-pressed", "true");
  await expect(todayButton).toBeFocused();
  await expect(returnToToday).toHaveCount(0);
});

for (const width of [320, 375, 390, 430]) {
  test(`temporary integration status stays neutral across detail navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const temporaryXunjiStatus = {
      ...integrationStatus,
      configured: true,
      maskedKey: "••••••••",
      sync: {
        ...integrationStatus.sync,
        status: "failed" as const,
        lastSucceededDate: localDate,
        lastErrorCode: "timeout",
        lastOutcome: { kind: "failed" as const, errorCode: "timeout" },
      },
    };
    const temporaryGarminStatus = {
      ...garminStatus,
      sync: {
        status: "failed" as const,
        lastAttemptAt: `${localDate}T08:00:00.000Z`,
        lastSucceededDate: localDate,
        nextCursor: null,
        lastErrorCode: "timeout" as const,
      },
    };
    const counters = await mockPrivateReads(
      page,
      0,
      planAdvice,
      evaluationAggregate,
      trendsAggregate,
      { integration: temporaryXunjiStatus, garmin: temporaryGarminStatus },
    );

    await page.goto("/settings/xunji");
    await expect(page.getByRole("main", { name: "训记设置" })).toBeVisible();
    await expect(
      page.getByText(
        "无需处理，系统会在下一次定时同步时重试；也可使用手动同步。",
      ),
    ).toBeVisible();
    await expect(page.getByText("最近成功日期：").first()).toContainText(
      localDate,
    );
    await expectMobileLayoutIntegrity(page);

    const detailRequestCount = counters.integration;
    await page.getByRole("link", { name: "返回" }).click();
    await expect(page).toHaveURL("/settings");
    await expect(
      page.getByRole("link", { name: /训记.*上次同步超时，将自动重试/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Garmin/ })).toBeVisible();
    await expect(page.locator(".settings-attention-summary")).toHaveCount(0);
    await expect.poll(() => counters.integration).toBe(detailRequestCount);
    await expectMobileLayoutIntegrity(page);

    await page.reload();
    await expect(page).toHaveURL("/settings");
    await expect(
      page.getByRole("link", { name: /训记.*上次同步超时，将自动重试/ }),
    ).toBeVisible();
    await expect(page.locator(".settings-attention-summary")).toHaveCount(0);
    await expectMobileLayoutIntegrity(page);
  });
}
