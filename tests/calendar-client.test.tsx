// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarClient } from "@/components/calendar-client";
import { ProtectedAppShell } from "@/components/protected-app-shell";

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function dayAggregate(date: string, title: string) {
  return {
    trackerKey: "knee-rehab",
    targetDate: date,
    plan: null,
    day: {
      state: "ready",
      trackerName: "Anonymous Tracker",
      startDate: "2026-07-01",
      planVersion: null,
      tasks: [
        {
          id: `019c0000-0000-7000-8000-${date.replaceAll("-", "").padEnd(12, "0")}`,
          title,
          category: "general",
          prescription: {},
          status: "planned",
          actual: null,
          subjectiveNote: null,
        },
      ],
      feedbackCount: 0,
      feedbacks: [],
    },
  };
}

function renderCalendar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProtectedAppShell>
        <CalendarClient initialDate="2026-07-19" />
      </ProtectedAppShell>
    </QueryClientProvider>,
  );
}

describe("calendar instant interaction (P0-04/P0-06)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/calendar?date=2026-07-19");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the app shell and calendar interactive while only detail waits (P0-04/P0-05)", async () => {
    const selected = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/calendar?month=")) {
        return Promise.resolve(
          jsonResponse({
            trackerKey: "knee-rehab",
            month: "2026-07",
            days: [],
          }),
        );
      }
      if (url.endsWith("/days/2026-07-20")) return selected.promise;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCalendar();
    const target = screen.getByRole("button", { name: /^2026-07-20/ });
    fireEvent.click(target);

    expect(target.className).toContain("selected");
    expect(window.location.search).toBe("?date=2026-07-20");
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "正在加载当天详情",
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/calendar?month="),
      ),
    ).toHaveLength(1);

    await act(async () => {
      selected.resolve(jsonResponse(dayAggregate("2026-07-20", "Newest day")));
    });
    expect(await screen.findByText("Newest day")).toBeTruthy();
  });

  it("does not let a late response overwrite a newer date", async () => {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/calendar?month=")) {
          return Promise.resolve(
            jsonResponse({
              trackerKey: "knee-rehab",
              month: "2026-07",
              days: [],
            }),
          );
        }
        if (url.endsWith("/days/2026-07-20")) return older.promise;
        if (url.endsWith("/days/2026-07-21")) return newer.promise;
        return new Promise<Response>(() => undefined);
      }),
    );

    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: /^2026-07-20/ }));
    fireEvent.click(screen.getByRole("button", { name: /^2026-07-21/ }));

    await act(async () => {
      newer.resolve(jsonResponse(dayAggregate("2026-07-21", "Newest day")));
    });
    expect(await screen.findByText("Newest day")).toBeTruthy();

    await act(async () => {
      older.resolve(jsonResponse(dayAggregate("2026-07-20", "Late old day")));
    });
    await waitFor(() => expect(screen.queryByText("Late old day")).toBeNull());
    expect(screen.getByText("Newest day")).toBeTruthy();
  });

  it("cancels an obsolete day request after rapid selection (P0-06)", async () => {
    const signals = new Map<string, AbortSignal>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/calendar?month=")) {
          return Promise.resolve(
            jsonResponse({
              trackerKey: "knee-rehab",
              month: "2026-07",
              days: [],
            }),
          );
        }
        const date = url.match(/\/days\/(\d{4}-\d{2}-\d{2})$/)?.[1];
        if (date && init?.signal) signals.set(date, init.signal);
        return new Promise<Response>(() => undefined);
      }),
    );

    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: /^2026-07-20/ }));
    await waitFor(() => expect(signals.has("2026-07-20")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /^2026-07-21/ }));

    await waitFor(() => expect(signals.get("2026-07-20")?.aborted).toBe(true));
  });
});
