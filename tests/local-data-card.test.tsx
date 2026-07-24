// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDataCard } from "@/components/local-data-card";
import { clearCurrentUserClientState } from "@/offline/clear-private-client-state";

const commandHarness = vi.hoisted(() => ({ commands: [] as unknown[] }));

vi.mock("@/offline/clear-private-client-state", () => ({
  clearCurrentUserClientState: vi.fn(),
}));
vi.mock("@/offline/offline-command-context", () => ({
  useOfflineCommands: () => ({ commands: commandHarness.commands }),
}));

describe("local private data controls (P0-08/P2a)", () => {
  afterEach(() => {
    cleanup();
    commandHarness.commands = [];
    vi.clearAllMocks();
  });

  it("clears Query and IndexedDB through the shared private-state boundary", async () => {
    vi.mocked(clearCurrentUserClientState).mockResolvedValue(undefined);
    render(<LocalDataCard />);

    fireEvent.click(screen.getByRole("button", { name: "清除本机数据" }));

    await waitFor(() =>
      expect(clearCurrentUserClientState).toHaveBeenCalledOnce(),
    );
    expect(await screen.findByText("本机数据已清除")).toBeTruthy();
  });

  it("requires explicit confirmation before discarding pending commands", async () => {
    commandHarness.commands = [{ id: "anonymous-command" }];
    vi.mocked(clearCurrentUserClientState).mockResolvedValue(undefined);
    render(<LocalDataCard />);

    fireEvent.click(screen.getByRole("button", { name: "清除本机数据" }));
    expect(clearCurrentUserClientState).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("1 条未完成同步");

    fireEvent.click(screen.getByRole("button", { name: "确认丢弃并清除" }));
    await waitFor(() =>
      expect(clearCurrentUserClientState).toHaveBeenCalledOnce(),
    );
  });

  it("links to the ordered pending-command status center with the current count", () => {
    commandHarness.commands = [{ id: "anonymous-command" }];
    render(<LocalDataCard />);

    const link = screen.getByRole("link", {
      name: "查看待同步记录（1）",
    });
    expect(link.getAttribute("href")).toBe("/settings/pending");
  });
});
