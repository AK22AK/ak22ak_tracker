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

async function pendingCommandCount(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("ak22ak-tracker", 3);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const count = database
            .transaction("pendingCommands", "readonly")
            .objectStore("pendingCommands")
            .count();
          count.onerror = () => reject(count.error);
          count.onsuccess = () => {
            database.close();
            resolve(count.result);
          };
        };
      }),
  );
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
  await expect(page.getByText("离线缓存 · 今日记录可保存")).toBeVisible();
  return page;
}

test("online direct access returns to the protected identity path", async ({
  page,
}) => {
  await page.goto("/offline.html");

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByText("离线缓存 · 今日记录可保存")).toHaveCount(0);
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
      "今日任务和身体反馈可先保存在本机；其他内容仅供查看，联网后由受保护应用同步。",
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

test("cold-start shell appends an unclassified feedback before updating the UI", async ({
  context,
  page,
}) => {
  const { today } = await prepareOnlineSnapshots(page);
  await context.setOffline(true);
  await page.close();

  const firstStart = await openOfflineColdStart(context, "/");
  await firstStart.getByRole("button", { name: "添加身体反馈" }).click();
  const formLayout = await firstStart.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    controls: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".offline-feedback-field input, .offline-feedback-field select, .offline-feedback-field textarea, .offline-feedback-checkbox, .offline-feedback-submit",
      ),
    ).map((control) => control.getBoundingClientRect().height),
  }));
  expect(formLayout.fits).toBe(true);
  expect(formLayout.controls.every((height) => height >= 44)).toBe(true);
  await firstStart.getByLabel("反馈时机").selectOption("incident");
  await firstStart.getByLabel("左膝疼痛（0–10）").fill("4");
  await firstStart.getByLabel("右膝疼痛（0–10）").fill("1");
  await firstStart.getByLabel("肿胀").selectOption("mild");
  await firstStart.getByLabel("僵硬").check();
  await firstStart.getByLabel("卡锁、伸不直或打软腿").check();
  await firstStart.getByLabel("主观补充").fill("Anonymous cold-start feedback");
  await firstStart.getByRole("button", { name: "保存反馈" }).click();

  await expect(firstStart.getByText("反馈已保存在本机")).toBeVisible();
  await expect(
    firstStart.getByText("安全级别等待联网后由服务器判断"),
  ).toBeVisible();
  await expect(firstStart.getByText("1 条仅保存在本机")).toBeVisible();
  await expect(
    firstStart.getByRole("button", { name: "返回今日" }),
  ).toBeVisible();
  await expect(
    firstStart.getByRole("button", { name: "继续添加反馈" }),
  ).toBeVisible();
  await firstStart.getByRole("button", { name: "继续添加反馈" }).click();
  await expect(firstStart.getByLabel("反馈时机")).toHaveValue("post_training");
  await expect(firstStart.getByLabel("左膝疼痛（0–10）")).toHaveValue("0");
  await expect(firstStart.getByLabel("右膝疼痛（0–10）")).toHaveValue("0");
  await expect(firstStart.getByLabel("主观补充")).toHaveValue("");
  await firstStart.getByRole("button", { name: "返回今日" }).click();
  await expect(firstStart.getByText("1 条本机反馈等待安全判断")).toBeVisible();
  await firstStart.close();

  const secondStart = await openOfflineColdStart(context, "/");
  await expect(secondStart.getByText("1 条本机反馈等待安全判断")).toBeVisible();
  await expect(secondStart.getByText("1 条仅保存在本机")).toBeVisible();
  await expect(secondStart.getByText("待判断", { exact: true })).toBeVisible();
  await expect(secondStart.getByText("绿灯", { exact: true })).toHaveCount(0);
  await secondStart.getByRole("button", { name: "再次添加反馈" }).click();
  await secondStart.getByLabel("反馈时机").selectOption("next_day");
  await secondStart.getByLabel("左膝疼痛（0–10）").fill("2");
  await secondStart.getByLabel("右膝疼痛（0–10）").fill("0");
  await secondStart
    .getByLabel("主观补充")
    .fill("Anonymous second offline feedback");
  await secondStart.getByRole("button", { name: "保存反馈" }).click();
  await expect(secondStart.getByText("2 条仅保存在本机")).toBeVisible();
  await secondStart.close();

  const thirdStart = await openOfflineColdStart(context, "/");
  await expect(thirdStart.getByText("2 条本机反馈等待安全判断")).toBeVisible();
  await expect(thirdStart.getByText("2 条仅保存在本机")).toBeVisible();
  await expect(thirdStart.getByText("待判断", { exact: true })).toBeVisible();
  await expect(thirdStart.getByText("绿灯", { exact: true })).toHaveCount(0);
  const commands = await thirdStart.evaluate(async () => {
    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = indexedDB.open("ak22ak-tracker", 3);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const getAll = database
          .transaction("pendingCommands", "readonly")
          .objectStore("pendingCommands")
          .getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          database.close();
          resolve(
            (getAll.result as Record<string, unknown>[])
              .filter((command) => command.kind === "symptom_check_in")
              .sort((left, right) =>
                String(left.createdAt).localeCompare(String(right.createdAt)),
              ),
          );
        };
      };
    });
  });
  expect(commands).toHaveLength(2);
  expect(new Set(commands.map((command) => command.id)).size).toBe(2);
  expect(
    String(commands[0]?.createdAt).localeCompare(
      String(commands[1]?.createdAt),
    ),
  ).toBeLessThan(0);
  for (const command of commands) {
    expect(command.schemaVersion).toBe(1);
    expect(command.localDate).toBe(today);
    expect(command.trackerKey).toBe(trackerKey);
    expect(command.status).toBe("local_only");
    expect(command.occurredTimeZone).toEqual(expect.any(String));
    expect(command.occurredUtcOffsetMinutes).toEqual(expect.any(Number));
    const payload = command.payload as Record<string, unknown>;
    expect(payload.clientSafetyPolicy).toBeNull();
    expect(payload.localSafetyLevel).toBeNull();
  }
  expect(
    await thirdStart.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("cold-start feedback keeps its draft and command id when write-ahead fails", async ({
  context,
  page,
}) => {
  await prepareOnlineSnapshots(page);
  await context.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        calls += 1;
        Reflect.set(globalThis, "__offlineUuidCalls", calls);
        return "019c0000-0000-4000-8000-000000000599";
      },
    });
  });
  await context.setOffline(true);
  await page.close();

  const coldStart = await openOfflineColdStart(context, "/");
  await coldStart.getByRole("button", { name: "添加身体反馈" }).click();
  await coldStart.getByLabel("反馈时机").selectOption("incident");
  await coldStart.getByLabel("左膝疼痛（0–10）").fill("6");
  await coldStart.getByLabel("右膝疼痛（0–10）").fill("2");
  await coldStart.getByLabel("肿胀").selectOption("obvious");
  await coldStart.getByLabel("跛行或无法正常负重").check();
  await coldStart
    .getByLabel("主观补充")
    .fill("Anonymous draft retained after failure");
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

  await coldStart.getByRole("button", { name: "保存反馈" }).click();
  await expect(coldStart.getByText("尚未保存，请重试。")).toBeVisible();
  await expect(coldStart.getByLabel("反馈时机")).toHaveValue("incident");
  await expect(coldStart.getByLabel("左膝疼痛（0–10）")).toHaveValue("6");
  await expect(coldStart.getByLabel("右膝疼痛（0–10）")).toHaveValue("2");
  await expect(coldStart.getByLabel("肿胀")).toHaveValue("obvious");
  await expect(coldStart.getByLabel("跛行或无法正常负重")).toBeChecked();
  await expect(coldStart.getByLabel("主观补充")).toHaveValue(
    "Anonymous draft retained after failure",
  );
  expect(
    await coldStart.evaluate(() =>
      Reflect.get(globalThis, "__offlineUuidCalls"),
    ),
  ).toBe(1);
  expect(await pendingCommandCount(coldStart)).toBe(0);

  await coldStart.evaluate(
    ({ identity }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("ak22ak-tracker", 3);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("metadata", "readwrite");
          transaction.objectStore("metadata").put({
            key: "active-identity",
            value: identity,
            updatedAt: new Date().toISOString(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    { identity: githubUserId },
  );
  await coldStart.getByRole("button", { name: "重试保存" }).click();
  await expect(coldStart.getByText("反馈已保存在本机")).toBeVisible();
  expect(
    await coldStart.evaluate(() =>
      Reflect.get(globalThis, "__offlineUuidCalls"),
    ),
  ).toBe(1);
  expect(await pendingCommandCount(coldStart)).toBe(1);
});

test("editing a failed cold-start feedback creates one new intent with the visible draft", async ({
  context,
  page,
}) => {
  const firstCommandId = "019c0000-0000-4000-8000-000000000601";
  const editedCommandId = "019c0000-0000-4000-8000-000000000602";
  await prepareOnlineSnapshots(page);
  await context.addInitScript(
    ({ firstId, editedId }) => {
      let calls = 0;
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: () => {
          calls += 1;
          Reflect.set(globalThis, "__offlineUuidCalls", calls);
          return calls === 1 ? firstId : editedId;
        },
      });
    },
    { firstId: firstCommandId, editedId: editedCommandId },
  );
  await context.setOffline(true);
  await page.close();

  const coldStart = await openOfflineColdStart(context, "/");
  await coldStart.getByRole("button", { name: "添加身体反馈" }).click();
  await coldStart.getByLabel("左膝疼痛（0–10）").fill("3");
  await coldStart.getByLabel("主观补充").fill("Anonymous first intent");
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
  await coldStart.getByRole("button", { name: "保存反馈" }).click();
  await expect(
    coldStart.getByRole("button", { name: "重试保存" }),
  ).toBeVisible();
  expect(
    await coldStart.evaluate(() =>
      Reflect.get(globalThis, "__offlineUuidCalls"),
    ),
  ).toBe(1);

  await coldStart.getByLabel("左膝疼痛（0–10）").fill("7");
  await coldStart.getByLabel("肿胀").selectOption("mild");
  await coldStart.getByLabel("固定骨性位置疼痛").check();
  await coldStart
    .getByLabel("主观补充")
    .fill("Anonymous edited intent after failure");
  await expect(
    coldStart.getByRole("button", { name: "保存修改后的反馈" }),
  ).toBeVisible();
  await expect(coldStart.getByText("内容已修改，尚未保存。")).toBeVisible();

  await coldStart.evaluate(
    ({ identity }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("ak22ak-tracker", 3);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("metadata", "readwrite");
          transaction.objectStore("metadata").put({
            key: "active-identity",
            value: identity,
            updatedAt: new Date().toISOString(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    { identity: githubUserId },
  );
  await coldStart.getByRole("button", { name: "保存修改后的反馈" }).click();
  await expect(coldStart.getByText("反馈已保存在本机")).toBeVisible();
  expect(
    await coldStart.evaluate(() =>
      Reflect.get(globalThis, "__offlineUuidCalls"),
    ),
  ).toBe(2);

  const commands = await coldStart.evaluate(async () => {
    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = indexedDB.open("ak22ak-tracker", 3);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const getAll = database
          .transaction("pendingCommands", "readonly")
          .objectStore("pendingCommands")
          .getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          database.close();
          resolve(getAll.result as Record<string, unknown>[]);
        };
      };
    });
  });
  expect(commands).toHaveLength(1);
  expect(commands[0]?.id).toBe(editedCommandId);
  expect(commands[0]?.id).not.toBe(firstCommandId);
  const payload = commands[0]?.payload as Record<string, unknown>;
  expect(payload.clientSafetyPolicy).toBeNull();
  expect(payload.localSafetyLevel).toBeNull();
  expect(payload.checkIn).toEqual(
    expect.objectContaining({
      leftPain: 7,
      swelling: "mild",
      localizedBonePain: true,
      note: "Anonymous edited intent after failure",
    }),
  );
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
  await expect(
    coldStart.getByRole("button", { name: "添加身体反馈" }),
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
  await expect(
    corruptToday.getByRole("button", { name: "添加身体反馈" }),
  ).toHaveCount(0);

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
