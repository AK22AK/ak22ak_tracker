// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { signOut } from "next-auth/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignOutButton } from "@/components/sign-out-button";
import { clearCurrentUserClientState } from "@/offline/clear-private-client-state";

const commandHarness = vi.hoisted(() => ({ commands: [] as unknown[] }));

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/offline/clear-private-client-state", () => ({
  clearCurrentUserClientState: vi.fn(),
}));
vi.mock("@/offline/offline-command-context", () => ({
  useOfflineCommands: () => ({ commands: commandHarness.commands }),
}));

describe("sign out with private offline commands", () => {
  afterEach(() => {
    cleanup();
    commandHarness.commands = [];
    vi.clearAllMocks();
  });

  it("clears local private state before signing out when nothing is pending", async () => {
    vi.mocked(clearCurrentUserClientState).mockResolvedValue(undefined);
    vi.mocked(signOut).mockResolvedValue(undefined);
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(clearCurrentUserClientState).toHaveBeenCalledOnce();
  });

  it("requires a second action before discarding pending commands", async () => {
    commandHarness.commands = [{ id: "anonymous-command" }];
    vi.mocked(clearCurrentUserClientState).mockResolvedValue(undefined);
    vi.mocked(signOut).mockResolvedValue(undefined);
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole("button", { name: "退出" }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("再次点击确认退出");

    fireEvent.click(
      screen.getByRole("button", { name: "确认退出（丢弃 1 条）" }),
    );
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });
});
