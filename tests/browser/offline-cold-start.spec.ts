import { expect, test } from "@playwright/test";

const githubUserId = "10001";
const trackerKey = "knee-rehab";

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

async function seedAnonymousSnapshots(
  page: import("@playwright/test").Page,
  options: { withPending?: boolean; trackerKey?: string } = {},
) {
  return page.evaluate(
    async ({ identity, key, withPending }) => {
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
        actual: {
          kind: "general",
          exercises: [],
          durationMinutes: 18,
          distanceKm: null,
          summary: "Anonymous cached actual",
        },
        subjectiveNote: "Anonymous cached note",
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
        const request = indexedDB.open("ak22ak-tracker", 3);
        request.onupgradeneeded = () => {
          const database = request.result;
          const snapshots = database.createObjectStore("querySnapshots", {
            keyPath: "id",
          });
          snapshots.createIndex("githubUserId", "githubUserId");
          database.createObjectStore("pendingCommands", { keyPath: "id" });
          database.createObjectStore("safetyPolicies", { keyPath: "id" });
          database.createObjectStore("metadata", { keyPath: "key" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["metadata", "querySnapshots", "pendingCommands"],
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
          if (withPending) {
            const common = (id: string, createdAt: string) => ({
              id,
              schemaVersion: 1,
              githubUserId: identity,
              trackerKey: key,
              createdAt,
              occurredAt: createdAt,
              localDate: today,
              occurredTimeZone: "Asia/Shanghai",
              occurredUtcOffsetMinutes: 480,
              attemptCount: 0,
              nextAttemptAt: createdAt,
              lastAttemptAt: null,
              lastErrorCode: null,
              status: "local_only",
              sourceVersion: null,
            });
            const pendingStore = transaction.objectStore("pendingCommands");
            pendingStore.put({
              ...common("019c0000-0000-7000-8000-000000000011", now),
              kind: "task_update",
              payload: {
                taskId: task.id,
                status: "completed",
                actual: {
                  kind: "general",
                  exercises: [],
                  durationMinutes: null,
                  distanceKm: null,
                  summary: "Anonymous local actual",
                },
                note: "Anonymous local note",
                baseStatus: "planned",
                planVersion: 1,
              },
            });
            for (const [index, localSafetyLevel] of [
              "yellow",
              null,
            ].entries()) {
              const occurredAt = new Date(
                Date.parse(now) + (index + 1) * 1_000,
              ).toISOString();
              pendingStore.put({
                ...common(
                  `019c0000-0000-7000-8000-00000000001${index + 2}`,
                  occurredAt,
                ),
                kind: "symptom_check_in",
                payload: {
                  checkIn: {
                    timing: "post_training",
                    leftPain: index === 0 ? 5 : 1,
                    rightPain: 0,
                    swelling: "none",
                    stiffness: false,
                    mechanicalSymptoms: false,
                    weightBearingIssue: false,
                    localizedBonePain: false,
                    nightOrRestPain: false,
                    note: "Anonymous local feedback",
                  },
                  clientSafetyPolicy:
                    index === 0
                      ? {
                          policyId: "019c0000-0000-7000-8000-000000000004",
                          version: 1,
                          hash: "a".repeat(64),
                        }
                      : null,
                  localSafetyLevel,
                },
              });
            }
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
    {
      identity: githubUserId,
      key: options.trackerKey ?? trackerKey,
      withPending: options.withPending ?? false,
    },
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

async function prepareOnlineSnapshots(
  page: import("@playwright/test").Page,
  options: { trackerKey?: string } = {},
) {
  await page.goto("/login");
  await waitForServiceWorkerControl(page);
  return seedAnonymousSnapshots(page, options);
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
        const request = indexedDB.open("ak22ak-tracker", 3);
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
  await expect(page.getByText("离线缓存 · 今日任务可记录")).toBeVisible();
  return page;
}

test("online direct access returns to the protected identity path", async ({
  page,
}) => {
  await page.goto("/offline.html");

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByText("离线缓存 · 今日任务可记录")).toHaveCount(0);
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
    coldStart.getByText(
      "今日任务状态可先保存在本机；其他内容仅供查看，联网后由受保护应用同步。",
    ),
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

test("cold-start shell persists ordered today task toggles before changing the UI", async ({
  context,
  page,
}) => {
  const { today } = await prepareOnlineSnapshots(page);
  await context.setOffline(true);
  await page.close();

  const firstStart = await openOfflineColdStart(context, "/");
  await expect(firstStart.getByText("仅保存在本机，联网后同步。")).toHaveCount(
    0,
  );
  await expect(firstStart.getByText("离线修改会先保存到本机。")).toBeVisible();
  await firstStart.getByRole("button", { name: "确认完成" }).click();
  await expect(firstStart.getByText("1 条仅保存在本机")).toBeVisible();
  await expect(firstStart.getByText("已完成")).toBeVisible();
  await expect(firstStart.getByText("仅保存在本机，联网后同步。")).toHaveCount(
    0,
  );
  await firstStart.close();

  const secondStart = await openOfflineColdStart(context, "/");
  await expect(secondStart.getByText("已完成")).toBeVisible();
  await expect(secondStart.getByText("1 条仅保存在本机")).toBeVisible();
  await secondStart.getByRole("button", { name: "恢复待完成" }).click();
  await expect(secondStart.getByText("2 条仅保存在本机")).toBeVisible();
  await secondStart.close();

  const thirdStart = await openOfflineColdStart(context, "/");
  await expect(thirdStart.getByText("待完成")).toBeVisible();
  await expect(thirdStart.getByText("2 条仅保存在本机")).toBeVisible();

  const commands = await thirdStart.evaluate(async () => {
    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = indexedDB.open("ak22ak-tracker", 3);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("pendingCommands", "readonly");
        const getAll = transaction.objectStore("pendingCommands").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () =>
          resolve(
            (getAll.result as Record<string, unknown>[]).sort((left, right) =>
              String(left.createdAt).localeCompare(String(right.createdAt)),
            ),
          );
      };
    });
  });
  expect(commands).toHaveLength(2);
  expect(commands.map((command) => command.status)).toEqual([
    "local_only",
    "local_only",
  ]);
  expect(commands.map((command) => command.schemaVersion)).toEqual([1, 1]);
  expect(commands.map((command) => command.localDate)).toEqual([today, today]);
  expect(commands.every((command) => command.trackerKey === trackerKey)).toBe(
    true,
  );
  expect(
    commands.every((command) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(command.id),
      ),
    ),
  ).toBe(true);
  expect(
    commands.every(
      (command) =>
        typeof command.occurredTimeZone === "string" &&
        Number.isInteger(command.occurredUtcOffsetMinutes),
    ),
  ).toBe(true);
  const payloads = commands.map(
    (command) => command.payload as Record<string, unknown>,
  );
  expect(payloads.map((payload) => payload.status)).toEqual([
    "completed",
    "planned",
  ]);
  expect(payloads.map((payload) => payload.baseStatus)).toEqual([
    "planned",
    "completed",
  ]);
  expect(payloads.every((payload) => payload.planVersion === 1)).toBe(true);
  expect(
    payloads.every(
      (payload) =>
        (payload.actual as Record<string, unknown>).summary ===
          "Anonymous cached actual" && payload.note === "Anonymous cached note",
    ),
  ).toBe(true);
  expect(
    String(commands[0]?.createdAt).localeCompare(
      String(commands[1]?.createdAt),
    ),
  ).toBeLessThan(0);

  const offlineCache = await cachedPaths(thirdStart);
  expect(offlineCache).not.toContain("/");
  expect(offlineCache).not.toContain("/calendar");
  expect(offlineCache.some((path) => path.startsWith("/api/"))).toBe(false);
  expect(offlineCache.some((path) => path.includes("_rsc"))).toBe(false);
});

test("cold-start shell never changes the task when write-ahead persistence fails", async ({
  context,
  page,
}) => {
  await prepareOnlineSnapshots(page);
  await context.setOffline(true);
  await page.close();

  const coldStart = await openOfflineColdStart(context, "/");
  await coldStart.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("ak22ak-tracker", 3);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("metadata", "readwrite");
          transaction.objectStore("metadata").put({
            key: "active-identity",
            value: "20002",
            updatedAt: new Date().toISOString(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );

  await coldStart.getByRole("button", { name: "确认完成" }).click();
  await expect(coldStart.getByText("尚未保存，请重试。")).toBeVisible();
  await expect(coldStart.getByText("仅保存在本机，联网后同步。")).toHaveCount(
    0,
  );
  await expect(coldStart.getByText("待完成")).toBeVisible();
  await expect(coldStart.getByText("已完成")).toHaveCount(0);
  await expect(coldStart.getByText(/条仅保存在本机/)).toHaveCount(0);
  expect(
    await coldStart.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open("ak22ak-tracker", 3);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const count = request.result
              .transaction("pendingCommands", "readonly")
              .objectStore("pendingCommands")
              .count();
            count.onerror = () => reject(count.error);
            count.onsuccess = () => resolve(count.result);
          };
        }),
    ),
  ).toBe(0);
});

test("cold-start shell keeps a non-knee tracker strictly read-only", async ({
  context,
  page,
}) => {
  await prepareOnlineSnapshots(page, { trackerKey: "anonymous-tracker" });
  await context.setOffline(true);
  await page.close();

  const coldStart = await openOfflineColdStart(context, "/");
  await expect(
    coldStart.getByText("Anonymous browser cache task"),
  ).toBeVisible();
  await expect(coldStart.getByRole("button", { name: "确认完成" })).toHaveCount(
    0,
  );
  await expect(
    coldStart.getByRole("button", { name: "恢复待完成" }),
  ).toHaveCount(0);
});

test("cold-start shell projects a task and two append-only feedback commands", async ({
  context,
  page,
}) => {
  const { today } = await prepareOnlineSnapshots(page);
  await seedAnonymousSnapshots(page, { withPending: true });
  await context.setOffline(true);
  await page.close();

  const coldStart = await openOfflineColdStart(context, "/");
  await expect(coldStart.getByText("3 条仅保存在本机")).toBeVisible();
  await expect(
    coldStart.getByText("身体反馈尚未完成安全判断，请联网前按保守原则处理。"),
  ).toBeVisible();
  await expect(coldStart.getByText("已完成")).toBeVisible();
  await expect(coldStart.getByText("已缓存 3 次反馈。")).toBeVisible();

  await coldStart.getByRole("button", { name: "日历" }).click();
  await expect(
    coldStart.getByRole("button", { name: `${today}，1 项任务` }),
  ).toBeVisible();
  await expect(coldStart.getByText("3 条仅保存在本机")).toBeVisible();
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
