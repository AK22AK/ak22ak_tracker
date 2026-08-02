import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

const baseURL = "http://127.0.0.1:4175";
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

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
  day: {
    state: "ready",
    trackerName: "Anonymous Tracker",
    startDate: "2026-07-01",
    planVersion: 1,
    tasks: [],
    feedbackCount: 0,
    feedbacks: [],
    externalTrainingRecords: [],
  },
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

async function authorize(context: BrowserContext) {
  const token = await encode({
    secret: "anonymous-startup-browser-test-secret",
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

async function mockStartupReads(page: Page) {
  const requests: string[] = [];
  let releaseTodayResponse: () => void = () => undefined;
  const todayResponseGate = new Promise<void>((resolve) => {
    releaseTodayResponse = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (url.pathname.endsWith("/today")) {
      await todayResponseGate;
      await route.fulfill({ status: 200, json: todayAggregate });
      return;
    }
    if (url.pathname === "/api/mirror/sync") {
      await route.fulfill({
        status: 200,
        json: {
          result: { status: "idle", processed: 0, succeeded: 0, failed: 0 },
          status: {
            configuration: "not_configured",
            pendingCount: 0,
            processingCount: 0,
            failedCount: 0,
            oldestPendingAt: null,
            lastSucceededAt: null,
            permissionError: false,
            delayed: false,
          },
        },
      });
      return;
    }
    if (
      url.pathname.endsWith("/garmin/recovery") ||
      url.pathname.endsWith("/garmin/wellness/recovery")
    ) {
      await route.fulfill({
        status: 200,
        json: {
          status: "skipped",
          reason: "not_connected",
          connection: {
            provider: "garmin",
            state: "disconnected",
            verifiedAt: null,
            updatedAt: null,
            lastErrorCode: null,
          },
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  return { requests, releaseTodayResponse };
}

test.beforeEach(async ({ context }) => authorize(context));

test("slow authenticated launch paints a neutral shell before auth and records safe milestones", async ({
  page,
}) => {
  const { requests, releaseTodayResponse } = await mockStartupReads(page);
  const navigationStartedAt = Date.now();
  await page.goto("/", { waitUntil: "commit" });

  await expect(page.locator("[data-startup-shell='true']")).toBeVisible({
    timeout: 1_000,
  });
  expect(Date.now() - navigationStartedAt).toBeLessThan(1_400);
  expect(
    await page.locator("[data-startup-shell='true']").textContent(),
  ).not.toMatch(/Anonymous|knee-rehab|10001/);
  expect(requests).toEqual([]);

  await expect
    .poll(() => requests.some((path) => path.endsWith("/today")))
    .toBe(true);
  expect(
    requests.some(
      (path) =>
        path === "/api/mirror/sync" || path.endsWith("/garmin/recovery"),
    ),
  ).toBe(false);
  releaseTodayResponse();

  await expect(
    page.locator("[data-today-content-visible='true']"),
  ).toBeVisible();
  await expect
    .poll(() =>
      requests.some(
        (path) =>
          path === "/api/mirror/sync" || path.endsWith("/garmin/recovery"),
      ),
    )
    .toBe(true);

  const measures = await page.evaluate(() =>
    performance
      .getEntriesByType("measure")
      .map(({ name }) => name)
      .filter((name) => name.startsWith("ak.startup.")),
  );
  expect(measures).toEqual(
    expect.arrayContaining([
      "ak.startup.document-to-fcp",
      "ak.startup.document-to-shell-hydrated",
      "ak.startup.document-to-today-request",
      "ak.startup.document-to-today-content",
    ]),
  );
});
