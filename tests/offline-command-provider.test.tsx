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

import {
  OfflineCommandProvider,
  useOfflineCommands,
} from "@/offline/offline-command-context";
import { clearOfflinePrivateData } from "@/offline/query-snapshots";
import { offlineDatabase } from "@/offline/store";

const commandId = "019c0000-0000-7000-8000-000000000701";

function Harness() {
  const { commands, ready, enqueue, replayNow } = useOfflineCommands();
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
      <output data-testid="command-status">
        {commands.map((command) => command.status).join(",")}
      </output>
    </div>
  );
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
});
