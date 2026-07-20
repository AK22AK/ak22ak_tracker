// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubMirrorCard } from "@/components/github-mirror-card";

const baseStatus = {
  configuration: "configured" as const,
  pendingCount: 2,
  processingCount: 0,
  failedCount: 0,
  oldestPendingAt: "2026-07-20T08:00:00.000Z",
  lastSucceededAt: null,
  permissionError: false,
  delayed: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GitHub mirror status card", () => {
  it("shows operational counts without technical payloads", () => {
    render(<GitHubMirrorCard initialStatus={baseStatus} />);
    expect(screen.getByText("待镜像 2 条")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows a permission error immediately and a delayed queue as a weak reminder", () => {
    const view = render(
      <GitHubMirrorCard
        initialStatus={{ ...baseStatus, failedCount: 1, permissionError: true }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("权限");
    view.unmount();
    render(
      <GitHubMirrorCard initialStatus={{ ...baseStatus, delayed: true }} />,
    );
    expect(screen.getByRole("status").textContent).toContain("超过 24 小时");
  });

  it("treats every failed outbox item as needing attention", () => {
    render(
      <GitHubMirrorCard
        initialStatus={{
          ...baseStatus,
          failedCount: 1,
          permissionError: false,
        }}
      />,
    );
    expect(screen.getByText("需要处理")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("部分记录需要处理");
    expect(screen.getByText("需要处理").className).toBe("integration-idle");
  });

  it("distinguishes invalid configuration from missing configuration", () => {
    render(
      <GitHubMirrorCard
        initialStatus={{
          ...baseStatus,
          configuration: "invalid_configuration",
          pendingCount: 0,
        }}
      />,
    );
    expect(screen.getByText("配置需处理")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("配置无效");
    expect(
      (screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("runs one bounded sync request and refreshes the safe status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            status: "succeeded",
            processed: 2,
            succeeded: 2,
            failed: 0,
          },
          status: {
            ...baseStatus,
            pendingCount: 0,
            lastSucceededAt: "2026-07-20T09:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<GitHubMirrorCard initialStatus={baseStatus} />);

    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() => expect(screen.getByText("待镜像 0 条")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/mirror/sync", {
      method: "POST",
    });
  });

  it("does not present a lost-lease result as a successful mirror", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            status: "unconfirmed",
            processed: 1,
            succeeded: 0,
            failed: 0,
          },
          status: { ...baseStatus, pendingCount: 0, processingCount: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<GitHubMirrorCard initialStatus={baseStatus} />);

    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("尚未确认"),
    );
    expect(screen.queryByText(/已镜像 0 条/)).toBeNull();
  });
});
