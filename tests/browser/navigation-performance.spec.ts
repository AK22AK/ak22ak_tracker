import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { aggregateEightWeekTrends } from "@/domain/trends";

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
  feedbacks: [],
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
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = null;
    if (url.pathname.endsWith("/today")) {
      counters.today += 1;
      body = todayAggregate;
    } else if (url.pathname.endsWith("/calendar")) {
      counters.month += 1;
      body = calendarAggregate;
    } else if (url.pathname.endsWith(`/days/${localDate}`)) {
      counters.day += 1;
      body = dayAggregate;
    } else if (url.pathname.endsWith("/integrations/xunji/credential")) {
      counters.integration += 1;
      body = integrationStatus;
    } else if (url.pathname.endsWith("/integrations/garmin/credential")) {
      counters.garmin += 1;
      body = garminStatus;
    } else if (url.pathname.endsWith("/integrations/garmin/wellness")) {
      body = garminWellnessProgress;
    } else if (url.pathname.endsWith("/integrations/deepseek/credential")) {
      counters.deepseek += 1;
      body = deepSeekStatus;
    } else if (url.pathname === "/api/mirror/status") {
      counters.mirror += 1;
      body = mirrorStatus;
    } else if (url.pathname.endsWith("/ai-analysis")) {
      counters.advice += 1;
      body = advice;
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

for (const width of [320, 375, 390, 430]) {
  test(`manual evaluation decision confirmation fits a ${width}px mobile viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0, planAdvice, evaluationDecisionAggregate);
    await page.goto("/trends/evaluation");

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
    await page.goto("/trends");

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
    await page.goto("/trends");

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
  test(`plan rollback confirmation remains accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0, rollbackAdvice);
    await page.goto("/trends/advice");

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
    await page.goto("/trends/evaluation");

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
    await page.goto("/trends/advice");

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
  await expect(page.locator(".settings-row")).toHaveCount(6);
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
  await expect(page.locator(".settings-row")).toHaveCount(6);
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
  await expect(page.locator(".settings-row")).toHaveCount(6);
  await expectActiveTab(page, "/settings", "/settings");

  await page.goBack();
  await expect(
    page
      .getByRole("main", { name: "Garmin设置" })
      .getByRole("heading", { name: "Garmin", level: 1 }),
  ).toBeVisible();
  await expectActiveTab(page, "/settings", "/settings/garmin");

  await page.goForward();
  await expect(page.locator(".settings-row")).toHaveCount(6);
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
  await expect(page.locator(".settings-row")).toHaveCount(6);
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
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 320);
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
  ).toHaveCount(6);
  await page.evaluate(() => window.scrollTo(0, 640));

  const calendarReturn = await measureTabClick(
    page,
    "/calendar",
    '[data-tab-panel="calendar"] .calendar-task',
  );
  expect(calendarReturn).toBeLessThan(100);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(320);
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
  ).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(640);
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

  await page.getByRole("link", { name: /趋势/ }).click();
  await expect(page.getByRole("main", { name: "趋势页面" })).toBeVisible();
  await expectActiveTab(page, "/trends", "/trends");
  await page.getByRole("link", { name: /今日/ }).click();
  await expect(
    page
      .locator('[data-tab-panel="today"] .task-card-summary')
      .getByText("Anonymous task", { exact: true }),
  ).toBeVisible();
  await expectActiveTab(page, "/", "/");

  await page.goBack();
  await expect(page.getByRole("main", { name: "趋势页面" })).toBeVisible();
  await expectActiveTab(page, "/trends", "/trends");
  await page.goBack();
  await expect(
    page.locator('[data-tab-panel="calendar"] .calendar-shell'),
  ).toBeVisible();
  await expectActiveTab(page, "/calendar", "/calendar", `?date=${localDate}`);
  await page.goForward();
  await expect(page.getByRole("main", { name: "趋势页面" })).toBeVisible();
  await expectActiveTab(page, "/trends", "/trends");
  await page.goForward();
  await expect(
    page
      .locator('[data-tab-panel="today"] .task-card-summary')
      .getByText("Anonymous task", { exact: true }),
  ).toBeVisible();
  await expectActiveTab(page, "/", "/");
});

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
