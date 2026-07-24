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
    },
  },
};

type RequestCounters = {
  today: number;
  month: number;
  day: number;
  integration: number;
  garmin: number;
  mirror: number;
  trends: number;
  advice: number;
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

async function mockPrivateReads(page: Page, delayMs: number) {
  const counters: RequestCounters = {
    today: 0,
    month: 0,
    day: 0,
    integration: 0,
    garmin: 0,
    mirror: 0,
    trends: 0,
    advice: 0,
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
    } else if (url.pathname === "/api/mirror/status") {
      counters.mirror += 1;
      body = mirrorStatus;
    } else if (url.pathname.endsWith("/ai-analysis")) {
      counters.advice += 1;
      body = planAdvice;
    } else if (url.pathname.endsWith("/trends")) {
      counters.trends += 1;
      body = trendsAggregate;
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
  test(`trend summaries remain accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/trends");

    await expect(page.getByRole("heading", { name: "本周完成" })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /本周任务完成率 50%/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: /本周完成训练 1 项，共 1 天；时长 35 分钟，覆盖 1 项；距离 未测量/,
      }),
    ).toBeVisible();
    await expect(page.getByText(/不表示两者存在因果关系/)).toBeVisible();
    await expect(
      page.getByRole("img", { name: /本周没有身体反馈/ }),
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        ".trend-refresh-button",
      );
      const rect = button?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        buttonHeight: rect?.height ?? 0,
        buttonRight: rect?.right ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(layout.buttonRight).toBeLessThanOrEqual(layout.clientWidth);
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
  test(`settings integration cards fit a ${width}px mobile viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockPrivateReads(page, 0);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Garmin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "训记" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "同步活动记录" }),
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".integration-card input, .integration-card button",
        ),
      ];
      const cards = [
        ...document.querySelectorAll<HTMLElement>(".integration-card"),
      ];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls: controls.map((control) => {
          const rect = control.getBoundingClientRect();
          const cardRect = control
            .closest<HTMLElement>(".integration-card")
            ?.getBoundingClientRect();
          return {
            height: rect.height,
            left: rect.left,
            right: rect.right,
            cardLeft: cardRect?.left ?? 0,
            cardRight: cardRect?.right ?? 0,
          };
        }),
        cards: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(
      layout.cards.every(
        ({ left, right }) => left >= 0 && right <= layout.clientWidth,
      ),
    ).toBe(true);
    expect(
      layout.controls.every(
        ({ height, left, right, cardLeft, cardRight }) =>
          height >= 44 && left >= cardLeft && right <= cardRight,
      ),
    ).toBe(true);

    await page.getByRole("link", { name: "今日" }).click();
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

test("warm Calendar and Settings content remains visible without aggregate refetch", async ({
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
    '[data-tab-panel="calendar"] .calendar-task',
  );
  expect(calendarFirst).toBeLessThan(100);
  await page.evaluate(() => {
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 320);
  });
  const requestsAfterCalendar = { ...counters };

  const settingsFirst = await measureTabClick(
    page,
    "/settings",
    '[data-tab-panel="settings"] .integration-card',
  );
  expect(settingsFirst).toBeLessThan(100);
  await page.getByLabel("API Key").fill("anonymous-ui-draft");
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
    '[data-tab-panel="settings"] .integration-card',
  );
  expect(settingsReturn).toBeLessThan(100);
  await expect(page.getByLabel("API Key")).toHaveValue("anonymous-ui-draft");
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
