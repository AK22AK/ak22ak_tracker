// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackerQueryKeys } from "@/client/query-keys";
import type { TodayAggregate } from "@/domain/api-contracts";
import {
  OfflineCommandProvider,
  useOfflineCommands,
} from "@/offline/offline-command-context";
import {
  enqueuePendingCommand,
  listPendingCommands,
} from "@/offline/pending-commands";
import {
  clearOfflinePrivateData,
  prepareOfflineIdentity,
  readQuerySnapshot,
} from "@/offline/query-snapshots";
import { offlineTodaySnapshotSchema } from "@/offline/snapshot-contracts";
import { offlineDatabase } from "@/offline/store";

const commandId = "019c0000-0000-7000-8000-000000000701";

function Harness() {
  const { commands, ready, enqueue, replayNow, discardNeedsAttentionHead } =
    useOfflineCommands();
  return (
    <div>
      <button
        type="button"
        disabled={!ready}
        onClick={() =>
          void enqueue({
            id: commandId,
            githubUserId: "10001",
            trackerKey: "knee-rehab",
            kind: "task_update",
            createdAt: "2026-07-19T20:00:00.000Z",
            occurredAt: "2026-07-19T20:00:00.000Z",
            localDate: "2026-07-20",
            occurredTimeZone: "Asia/Shanghai",
            occurredUtcOffsetMinutes: 480,
            payload: {
              taskId: "019c0000-0000-7000-8000-000000000702",
              status: "completed",
              actual: null,
              note: null,
              baseStatus: "planned",
              planVersion: 1,
            },
          })
        }
      >
        queue
      </button>
      <button type="button" onClick={() => void replayNow()}>
        retry
      </button>
      <button
        type="button"
        onClick={() => void discardNeedsAttentionHead(commandId)}
      >
        discard
      </button>
      <output data-testid="command-status">
        {commands.map((command) => command.status).join(",")}
      </output>
    </div>
  );
}

function canonicalToday(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-20",
    plan: {
      id: "019c0000-0000-7000-8000-000000000703",
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
          id: "019c0000-0000-7000-8000-000000000702",
          title: "Anonymous task",
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
      policyId: "019c0000-0000-7000-8000-000000000704",
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
}

describe("P2b-1 offline replay triggers", () => {
  afterEach(async () => {
    cleanup();
    await clearOfflinePrivateData(offlineDatabase);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows syncing and coalesces online, visible, focus, and manual replay triggers", async () => {
    let resolveRequest!: (value: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn(() => request);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <OfflineCommandProvider githubUserId="10001">
          <Harness />
        </OfflineCommandProvider>
      </QueryClientProvider>,
    );

    const queue = await screen.findByRole("button", { name: "queue" });
    await waitFor(() =>
      expect((queue as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(queue);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("syncing")).toBeTruthy());

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest(
      Response.json({
        commandId,
        status: "completed",
        replayed: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("command-status").textContent).toBe(""),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await offlineDatabase.pendingCommands.count()).toBe(0);
  });

  it("discards only an online needs-attention head, restores canonical views, and continues the queue", async () => {
    const laterCommandId = "019c0000-0000-7000-8000-000000000705";
    const today = canonicalToday();
    await prepareOfflineIdentity(offlineDatabase, "10001");
    await enqueuePendingCommand(offlineDatabase, {
      id: commandId,
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "task_update",
      createdAt: "2026-07-20T10:00:00.000Z",
      occurredAt: "2026-07-20T10:00:00.000Z",
      localDate: "2026-07-20",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      payload: {
        taskId: today.day.tasks[0]!.id,
        status: "completed",
        actual: null,
        note: null,
        baseStatus: "planned",
        planVersion: 1,
      },
    });
    const head = await offlineDatabase.pendingCommands.get(commandId);
    await offlineDatabase.pendingCommands.put({
      ...head!,
      status: "needs_attention",
      lastErrorCode: "version_conflict",
    });
    await enqueuePendingCommand(offlineDatabase, {
      id: laterCommandId,
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "task_update",
      createdAt: "2026-07-20T10:01:00.000Z",
      occurredAt: "2026-07-20T10:01:00.000Z",
      localDate: "2026-07-20",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      payload: {
        taskId: today.day.tasks[0]!.id,
        status: "skipped",
        actual: null,
        note: null,
        baseStatus: "completed",
        planVersion: 1,
      },
    });
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/today")) return Response.json(today);
      if (url.includes("/days/")) {
        return Response.json({
          trackerKey: "knee-rehab",
          targetDate: "2026-07-20",
          plan: today.plan,
          day: today.day,
        });
      }
      if (url.includes("/calendar")) {
        return Response.json({
          trackerKey: "knee-rehab",
          month: "2026-07",
          days: [
            {
              date: "2026-07-20",
              taskCount: 1,
              completedCount: 0,
              skippedCount: 0,
              feedbackCount: 0,
            },
          ],
        });
      }
      if (url.includes("/api/tasks/")) {
        return Response.json({
          commandId: laterCommandId,
          status: "skipped",
          replayed: false,
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <OfflineCommandProvider githubUserId="10001">
          <Harness />
        </OfflineCommandProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("command-status").textContent).toBe(
        "needs_attention,local_only",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "discard" }));

    await waitFor(() =>
      expect(screen.getByTestId("command-status").textContent).toBe(""),
    );
    expect(
      await listPendingCommands(offlineDatabase, "10001", "knee-rehab"),
    ).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      queryClient.getQueryData<TodayAggregate>(
        trackerQueryKeys.today("knee-rehab", "2026-07-20"),
      )?.day.tasks[0]?.status,
    ).toBe("skipped");
    const restored = await readQuerySnapshot(offlineDatabase, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-20",
    });
    expect(
      offlineTodaySnapshotSchema.parse(restored?.data).day.tasks[0]?.status,
    ).toBe("skipped");
  });
});
