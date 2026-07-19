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

vi.mock("@/offline/clear-private-client-state", () => ({
  clearCurrentUserClientState: vi.fn(),
}));

describe("local private data controls (P0-08/P2a)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("clears Query and IndexedDB through the shared private-state boundary", async () => {
    vi.mocked(clearCurrentUserClientState).mockResolvedValue(undefined);
    render(<LocalDataCard />);

    fireEvent.click(screen.getByRole("button", { name: "清除本机数据" }));

    await waitFor(() =>
      expect(clearCurrentUserClientState).toHaveBeenCalledOnce(),
    );
    expect(await screen.findByText("本机私人缓存已清除")).toBeTruthy();
  });
});
