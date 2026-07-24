// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { integrationQueryKeys } from "@/client/query-keys";
import { GitHubMirrorCard } from "@/components/github-mirror-card";
import type { GitHubMirrorStatus } from "@/domain/github-mirror";

const baseStatus: GitHubMirrorStatus = {
  configuration: "configured",
  pendingCount: 2,
  processingCount: 0,
  failedCount: 0,
  oldestPendingAt: "2026-07-20T08:00:00.000Z",
  lastSucceededAt: null,
  permissionError: false,
  delayed: false,
};

function renderMirrorCard(
  initialStatus = baseStatus,
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GitHubMirrorCard initialStatus={initialStatus} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GitHub mirror status card", () => {
  it("shows operational counts without technical payloads", () => {
    renderMirrorCard();
    expect(screen.getByText("待备份 2 条")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows a permission error immediately and a delayed queue as a weak reminder", () => {
    const view = renderMirrorCard({
      ...baseStatus,
      failedCount: 1,
      permissionError: true,
    });
    expect(screen.getByRole("alert").textContent).toContain("权限");
    view.unmount();
    renderMirrorCard({ ...baseStatus, delayed: true });
    expect(screen.getByRole("status").textContent).toContain("超过 24 小时");
  });

  it("treats every failed outbox item as needing attention", () => {
    renderMirrorCard({
      ...baseStatus,
      failedCount: 1,
      permissionError: false,
    });
    expect(screen.getByText("需要处理")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("部分记录需要处理");
    expect(screen.getByText("需要处理").className).toBe("integration-idle");
  });

  it("distinguishes invalid configuration from missing configuration", () => {
    renderMirrorCard({
      ...baseStatus,
      configuration: "invalid_configuration",
      pendingCount: 0,
    });
    expect(screen.getByText("设置有误")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("设置有误");
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
    renderMirrorCard();

    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() => expect(screen.getByText("待备份 0 条")).toBeTruthy());
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
    renderMirrorCard();

    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("尚未确认"),
    );
    expect(screen.queryByText(/已备份 0 条/)).toBeNull();
  });

  it("observes the same exact status cache updated by app recovery", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    });
    renderMirrorCard(baseStatus, queryClient);

    queryClient.setQueryData(integrationQueryKeys.githubMirrorStatus(), {
      ...baseStatus,
      pendingCount: 0,
      lastSucceededAt: "2026-07-23T05:00:00.000Z",
    });

    await waitFor(() => expect(screen.getByText("待备份 0 条")).toBeTruthy());
  });
});
