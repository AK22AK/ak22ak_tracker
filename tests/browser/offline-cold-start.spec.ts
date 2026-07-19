import { expect, test } from "@playwright/test";

const githubUserId = "10001";
const trackerKey = "anonymous-tracker";

async function waitForServiceWorkerControl(
  page: import("@playwright/test").Page,
) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => resolve(),
        {
          once: true,
        },
      );
    });
  });
}

async function seedAnonymousSnapshots(page: import("@playwright/test").Page) {
  return page.evaluate(
    async ({ identity, key }) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? "";
      const today = `${part("year")}-${part("month")}-${part("day")}`;
      const month = today.slice(0, 7);
      const now = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const task = {
        id: "019c0000-0000-7000-8000-000000000001",
        title: "Anonymous browser cache task",
        category: "general",
        prescription: { main: "Anonymous cached dose" },
        status: "planned",
        actual: null,
        subjectiveNote: null,
      };
      const day = {
        state: "ready",
        trackerName: "Anonymous Tracker",
        startDate: today,
        planVersion: 1,
        tasks: [task],
        feedbackCount: 1,
        feedbacks: [
          {
            id: "019c0000-0000-7000-8000-000000000002",
            occurredAt: now,
            timing: "morning",
            leftPain: 0,
            rightPain: 0,
            swelling: "none",
            safetyLevel: "green",
            note: "Anonymous feedback",
          },
        ],
        externalTrainingRecords: [],
      };
      const plan = {
        id: "019c0000-0000-7000-8000-000000000003",
        version: 1,
        effectiveFrom: today,
      };
      const tracker = {
        key,
        name: "Anonymous Tracker",
        startedOn: today,
        planningTimeZone: "Asia/Shanghai",
      };
      const rows = [
        {
          id: `${identity}:${key}:today:${today}`,
          githubUserId: identity,
          trackerKey: key,
          kind: "today",
          scope: today,
          schemaVersion: 2,
          savedAt: now,
          expiresAt,
          sourceVersion: "anonymous-today-v1",
          data: {
            tracker,
            targetDate: today,
            plan,
            day,
            safetyPolicy: {
              policyId: "019c0000-0000-7000-8000-000000000004",
              version: 1,
              hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            execution: {
              context: null,
              day: null,
              alternatives: [],
              safety: { blocked: false, reason: null },
            },
          },
        },
        {
          id: `${identity}:${key}:calendar-month:${month}`,
          githubUserId: identity,
          trackerKey: key,
          kind: "calendar-month",
          scope: month,
          schemaVersion: 2,
          savedAt: now,
          expiresAt,
          sourceVersion: "anonymous-month-v1",
          data: {
            trackerKey: key,
            month,
            days: [
              {
                date: today,
                taskCount: 1,
                completedCount: 0,
                skippedCount: 0,
                feedbackCount: 1,
              },
            ],
          },
        },
        {
          id: `${identity}:${key}:day:${today}`,
          githubUserId: identity,
          trackerKey: key,
          kind: "day",
          scope: today,
          schemaVersion: 2,
          savedAt: now,
          expiresAt,
          sourceVersion: "anonymous-day-v1",
          data: { trackerKey: key, targetDate: today, plan, day },
        },
      ];

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("ak22ak-tracker", 2);
        request.onupgradeneeded = () => {
          const database = request.result;
          const snapshots = database.createObjectStore("querySnapshots", {
            keyPath: "id",
          });
          snapshots.createIndex("githubUserId", "githubUserId");
          database.createObjectStore("pendingCommands", { keyPath: "id" });
          database.createObjectStore("metadata", { keyPath: "key" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["metadata", "querySnapshots"],
            "readwrite",
          );
          transaction.objectStore("metadata").put({
            key: "active-identity",
            value: identity,
            updatedAt: now,
          });
          for (const row of rows) {
            transaction.objectStore("querySnapshots").put(row);
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
      return { today };
    },
    { identity: githubUserId, key: trackerKey },
  );
}

async function cachedPaths(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        paths.push(`${url.pathname}${url.search}`);
      }
    }
    return paths;
  });
}

async function prepareOnlineSnapshots(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await waitForServiceWorkerControl(page);
  return seedAnonymousSnapshots(page);
}

async function corruptSnapshot(
  page: import("@playwright/test").Page,
  input: {
    kind: "today" | "calendar-month" | "day";
    scope: string;
  },
) {
  await page.evaluate(
    async ({ identity, key, kind, scope }) => {
      const id = `${identity}:${key}:${kind}:${scope}`;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("ak22ak-tracker", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            "querySnapshots",
            "readwrite",
          );
          const store = transaction.objectStore("querySnapshots");
          const getRequest = store.get(id);
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            const row = getRequest.result;
            if (!row) {
              reject(new Error(`Missing snapshot ${id}`));
              return;
            }
            if (kind === "today") {
              row.data = { ...row.data, tracker: null };
            } else if (kind === "calendar-month") {
              row.data = {
                ...row.data,
                days: row.data.days.map(
                  (day: Record<string, unknown>, index: number) =>
                    index === 0 ? { ...day, taskCount: "one" } : day,
                ),
              };
            } else {
              row.data = {
                ...row.data,
                day: { ...row.data.day, tasks: "not-an-array" },
              };
            }
            store.put(row);
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    {
      identity: githubUserId,
      key: trackerKey,
      kind: input.kind,
      scope: input.scope,
    },
  );
}

async function openOfflineColdStart(
  context: import("@playwright/test").BrowserContext,
  path: "/" | "/calendar",
) {
  const page = await context.newPage();
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("离线缓存 · 仅供查看")).toBeVisible();
  return page;
}

test("online direct access returns to the protected identity path", async ({
  page,
}) => {
  await page.goto("/offline.html");

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByText("离线缓存 · 仅供查看")).toHaveCount(0);
});

test("cold starts from the public shell after the old document is destroyed", async ({
  context,
  page,
}) => {
  const { today } = await prepareOnlineSnapshots(page);
  const onlineCache = await cachedPaths(page);
  expect(onlineCache).toEqual(
    expect.arrayContaining([
      "/offline.html",
      "/offline.css",
      "/offline-contract.js",
      "/offline.js",
    ]),
  );
  expect(onlineCache).not.toContain("/");
  expect(onlineCache.some((path) => path.startsWith("/api/"))).toBe(false);
  expect(onlineCache.some((path) => path.includes("_rsc"))).toBe(false);

  await context.setOffline(true);
  await page.close();
  expect(context.pages()).toHaveLength(0);

  const coldStart = await openOfflineColdStart(context, "/");
  await expect(
    coldStart.getByText("Anonymous browser cache task"),
  ).toBeVisible();
  await expect(coldStart.getByText(/最近更新：/)).toBeVisible();
  await expect(
    coldStart.getByText("离线提交尚未开放，请联网后操作。"),
  ).toBeVisible();
  expect(
    await coldStart.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await coldStart.getByRole("button", { name: "日历" }).click();
  await expect(coldStart).toHaveURL(/\/calendar$/);
  await expect(
    coldStart.getByRole("button", { name: new RegExp(today) }),
  ).toBeVisible();
  await expect(
    coldStart.getByText("Anonymous browser cache task"),
  ).toBeVisible();

  const offlineCache = await cachedPaths(coldStart);
  expect(offlineCache).not.toContain("/");
  expect(offlineCache).not.toContain("/calendar");
  expect(offlineCache.some((path) => path.startsWith("/api/"))).toBe(false);

  await coldStart.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("ak22ak-tracker");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
  );
  await coldStart.close();

  const emptyColdStart = await context.newPage();
  await emptyColdStart.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    emptyColdStart.getByText("当前没有可用的今日缓存"),
  ).toBeVisible();
  await expect(
    emptyColdStart.getByText("Anonymous browser cache task"),
  ).toHaveCount(0);
});

test("corrupt today, month, and day snapshots never render as real zero data", async ({
  context,
  page,
}) => {
  const { today } = await prepareOnlineSnapshots(page);
  const month = today.slice(0, 7);
  await corruptSnapshot(page, { kind: "today", scope: today });
  await context.setOffline(true);
  await page.close();

  const corruptToday = await openOfflineColdStart(context, "/");
  await expect(corruptToday.getByText("当前没有可用的今日缓存")).toBeVisible();
  await expect(corruptToday.getByText("已缓存 0 次反馈。")).toHaveCount(0);

  await seedAnonymousSnapshots(corruptToday);
  await corruptSnapshot(corruptToday, {
    kind: "calendar-month",
    scope: month,
  });
  await corruptToday.close();

  const corruptMonth = await openOfflineColdStart(context, "/calendar");
  await expect(corruptMonth.getByText("当前月份没有有效缓存")).toBeVisible();
  await expect(
    corruptMonth.getByRole("button", { name: `${today}，1 项任务` }),
  ).toHaveCount(0);

  await seedAnonymousSnapshots(corruptMonth);
  await corruptSnapshot(corruptMonth, { kind: "day", scope: today });
  await corruptMonth.close();

  const corruptDay = await openOfflineColdStart(context, "/calendar");
  await expect(
    corruptDay.getByText("这一天没有有效的本机详情缓存。"),
  ).toBeVisible();
  await expect(
    corruptDay.getByText("Anonymous browser cache task"),
  ).toHaveCount(0);
});
