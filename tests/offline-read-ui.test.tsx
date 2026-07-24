// @vitest-environment jsdom

import "fake-indexeddb/auto";

import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarClient } from "@/components/calendar-client";
import { TodayClient } from "@/components/today-client";
import type {
  CalendarAggregate,
  DayAggregate,
  TodayAggregate,
} from "@/domain/api-contracts";
import { clearOfflinePrivateData } from "@/offline/query-snapshots";
import { PrivateOfflineIdentityProvider } from "@/offline/private-offline-context";
import { offlineDatabase } from "@/offline/store";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/domain/planning-time", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/domain/planning-time")>();
  return { ...original, localDateInTimeZone: () => "2026-07-21" };
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function todayAggregate(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-21",
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
      tasks: [
        {
          id: "019c0000-0000-7000-8000-000000000002",
          title: "Anonymous offline task",
          category: "general",
          prescription: { main: "Anonymous dose" },
          status: "planned",
          actual: null,
          subjectiveNote: null,
        },
      ],
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
          id: "anonymous-rule",
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
}

function renderPrivate(children: React.ReactNode, githubUserId = "10001") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrivateOfflineIdentityProvider githubUserId={githubUserId}>
        {children}
      </PrivateOfflineIdentityProvider>
    </QueryClientProvider>,
  );
}

describe("P2 offline snapshot UI", () => {
  beforeEach(async () => {
    onlineManager.setOnline(true);
    await clearOfflinePrivateData(offlineDatabase);
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists an authenticated online Today read and restores it after an offline restart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(todayAggregate())),
    );
    const online = renderPrivate(<TodayClient />);
    expect(await screen.findByText("Anonymous offline task")).toBeTruthy();
    await waitFor(async () => {
      expect(await offlineDatabase.querySnapshots.count()).toBe(1);
    });
    online.unmount();

    onlineManager.setOnline(false);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderPrivate(<TodayClient />);

    expect(await screen.findByText("当前离线 · 显示本机内容")).toBeTruthy();
    expect(screen.getByText(/其他操作请联网后进行/)).toBeTruthy();
    expect(screen.getByText("Anonymous offline task")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Anonymous offline task",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByRole("link", { name: "添加反馈" })).toBeTruthy();
  });

  it("distinguishes an online Today snapshot refresh from a true offline state", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(todayAggregate())),
    );
    const seeded = renderPrivate(<TodayClient />);
    expect(await screen.findByText("Anonymous offline task")).toBeTruthy();
    await waitFor(async () =>
      expect(await offlineDatabase.querySnapshots.count()).toBe(1),
    );
    seeded.unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderPrivate(<TodayClient />);

    expect(await screen.findByText("正在获取最新内容")).toBeTruthy();
    expect(screen.getByText(/暂时显示本机内容/)).toBeTruthy();
    expect(screen.queryByText(/其他操作请联网后进行/)).toBeNull();
  });

  it("never restores another GitHub identity's snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(todayAggregate())),
    );
    const first = renderPrivate(<TodayClient />, "10001");
    expect(await screen.findByText("Anonymous offline task")).toBeTruthy();
    await waitFor(async () =>
      expect(await offlineDatabase.querySnapshots.count()).toBe(1),
    );
    first.unmount();

    onlineManager.setOnline(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderPrivate(<TodayClient />, "10002");

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /本机没有可用内容|无法加载/,
    );
    expect(screen.queryByText("Anonymous offline task")).toBeNull();
    await waitFor(async () =>
      expect(await offlineDatabase.querySnapshots.count()).toBe(0),
    );
  });

  it("restores the calendar month and selected day without enabling association writes", async () => {
    const today = todayAggregate();
    const month: CalendarAggregate = {
      trackerKey: "knee-rehab",
      month: "2026-07",
      days: [
        {
          date: "2026-07-21",
          taskCount: 1,
          completedCount: 0,
          skippedCount: 0,
          feedbackCount: 0,
        },
      ],
    };
    const day: DayAggregate = {
      trackerKey: "knee-rehab",
      targetDate: "2026-07-21",
      plan: today.plan,
      day: today.day,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          jsonResponse(String(input).includes("/calendar?") ? month : day),
        ),
      ),
    );
    const online = renderPrivate(<CalendarClient initialDate="2026-07-21" />);
    expect(await screen.findByText("Anonymous offline task")).toBeTruthy();
    await waitFor(async () =>
      expect(await offlineDatabase.querySnapshots.count()).toBe(2),
    );
    online.unmount();

    onlineManager.setOnline(false);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderPrivate(<CalendarClient initialDate="2026-07-21" />);

    expect(await screen.findByText("当前离线 · 仅供查看")).toBeTruthy();
    expect(screen.getByText(/训练关联请联网后操作/)).toBeTruthy();
    expect(await screen.findByText("Anonymous offline task")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /^2026-07-21/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("distinguishes an online Calendar snapshot refresh from a true offline state", async () => {
    const today = todayAggregate();
    const month: CalendarAggregate = {
      trackerKey: "knee-rehab",
      month: "2026-07",
      days: [
        {
          date: "2026-07-21",
          taskCount: 1,
          completedCount: 0,
          skippedCount: 0,
          feedbackCount: 0,
        },
      ],
    };
    const day: DayAggregate = {
      trackerKey: "knee-rehab",
      targetDate: "2026-07-21",
      plan: today.plan,
      day: today.day,
    };
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          jsonResponse(String(input).includes("/calendar?") ? month : day),
        ),
      ),
    );
    const seeded = renderPrivate(<CalendarClient initialDate="2026-07-21" />);
    expect(await screen.findByText("Anonymous offline task")).toBeTruthy();
    await waitFor(async () =>
      expect(await offlineDatabase.querySnapshots.count()).toBe(2),
    );
    seeded.unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderPrivate(<CalendarClient initialDate="2026-07-21" />);

    expect(await screen.findByText("正在获取最新内容")).toBeTruthy();
    expect(screen.getByText(/暂时显示本机内容/)).toBeTruthy();
    expect(screen.queryByText(/训练关联请联网后操作/)).toBeNull();
  });
});
