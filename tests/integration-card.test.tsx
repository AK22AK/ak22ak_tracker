// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntegrationCard } from "@/components/integration-card";

const disconnected = {
  provider: "xunji",
  configured: false,
  maskedKey: null,
  verifiedAt: null,
  updatedAt: null,
  sync: {
    status: "idle" as const,
    lastAttemptAt: null,
    lastSucceededAt: null,
    lastSucceededDate: null,
    lastErrorCode: null,
  },
};

describe("provider-neutral integration card", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears the submitted key and renders only masked connection metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
          verifiedAt: "2026-07-19T08:00:00.000Z",
          updatedAt: "2026-07-19T08:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "Anonymous Provider",
          description: "Anonymous read-only training source",
        }}
        initialStatus={disconnected}
      />,
    );

    const keyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "anonymous-fake-key" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并保存" }));

    await waitFor(() => expect(keyInput.value).toBe(""));
    expect(screen.getByText("已连接")).toBeTruthy();
    expect(document.body.textContent).not.toContain("anonymous-fake-key");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/anonymous-tracker/integrations/xunji/credential",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("stops client continuation on a failed batch without clearing the key draft", async () => {
    const configured = {
      ...disconnected,
      configured: true,
      maskedKey: "••••••••" as const,
    };
    const firstBatch = {
      provider: "xunji",
      batch: { from: "2026-07-01", to: "2026-07-02" },
      targetDate: "2026-07-04",
      days: [
        {
          date: "2026-07-01",
          status: "succeeded",
          cached: false,
          created: 1,
          changed: 0,
          unchanged: 0,
          recordCount: 1,
          syncedAt: "2026-07-04T08:00:00.000Z",
        },
        {
          date: "2026-07-02",
          status: "succeeded",
          cached: false,
          created: 0,
          changed: 0,
          unchanged: 1,
          recordCount: 1,
          syncedAt: "2026-07-04T08:00:00.000Z",
        },
      ],
      summary: {
        succeeded: 2,
        failed: 0,
        created: 1,
        changed: 0,
        unchanged: 1,
      },
      nextCursor: "2026-07-03",
      complete: false,
      lastSucceededDate: "2026-07-02",
    };
    const secondBatch = {
      provider: "xunji",
      batch: { from: "2026-07-03", to: "2026-07-03" },
      targetDate: "2026-07-04",
      days: [
        {
          date: "2026-07-03",
          status: "failed",
          errorCode: "rate_limited",
        },
      ],
      summary: {
        succeeded: 0,
        failed: 1,
        created: 0,
        changed: 0,
        unchanged: 0,
      },
      nextCursor: "2026-07-03",
      complete: false,
      lastSucceededDate: "2026-07-02",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstBatch), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(secondBatch), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "Anonymous Provider",
          description: "Anonymous read-only training source",
        }}
        initialStatus={configured}
      />,
    );

    const keyInput = screen.getByLabelText("更新 API Key") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "anonymous-draft-key" } });
    fireEvent.click(screen.getByRole("button", { name: "同步到今天" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/请求过于频繁，请稍后重试/)).toBeTruthy(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyInput.value).toBe("anonymous-draft-key");
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe(
        "/api/trackers/anonymous-tracker/integrations/xunji/sync",
      );
      expect(request).toEqual(expect.objectContaining({ method: "POST" }));
      expect(request).not.toHaveProperty("body");
    }
  });

  it.each([
    ["authentication", "连接已失效，请更新 API Key 后重试"],
    ["timeout", "暂时无法同步，请稍后重试"],
    ["provider_unavailable", "暂时无法同步，请稍后重试"],
    ["membership_required", "仅支持 VIP 会员使用，请升级会员后重试"],
    ["invalid_response", "返回异常，请稍后重试"],
  ])("renders a safe actionable message for %s", async (errorCode, text) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: "xunji",
          batch: { from: "2026-07-03", to: "2026-07-03" },
          targetDate: "2026-07-04",
          days: [{ date: "2026-07-03", status: "failed", errorCode }],
          summary: {
            succeeded: 0,
            failed: 1,
            created: 0,
            changed: 0,
            unchanged: 0,
          },
          nextCursor: "2026-07-03",
          complete: false,
          lastSucceededDate: "2026-07-02",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "Anonymous Provider",
          description: "Anonymous read-only training source",
        }}
        initialStatus={{
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "同步到今天" }));

    await waitFor(() =>
      expect(screen.getByText(new RegExp(text))).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("provider failed");
  });

  it("maps a safe provider error from a non-success HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "membership_required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "Anonymous Provider",
          description: "Anonymous read-only training source",
        }}
        initialStatus={{
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "同步到今天" }));

    await waitFor(() =>
      expect(
        screen.getByText(/仅支持 VIP 会员使用，请升级会员后重试/),
      ).toBeTruthy(),
    );
  });

  it("shows a persisted failure immediately and disables sync while another operation runs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "sync_in_progress" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "训记",
          description: "Anonymous read-only training source",
        }}
        initialStatus={{
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
          sync: {
            ...disconnected.sync,
            status: "failed",
            lastErrorCode: "membership_required",
          },
        }}
      />,
    );

    expect(screen.getByText(/仅支持 VIP 会员使用/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "同步到今天" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        screen.getByText("另一项训记同步正在进行，请稍后继续。"),
      ).toBeTruthy(),
    );
    expect(
      (
        screen.getByRole("button", {
          name: /另一项训记同步正在进行/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("renders and enforces a safe retry_after_ms countdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        provider: "xunji",
        batch: { from: "2026-07-03", to: "2026-07-03" },
        targetDate: "2026-07-04",
        days: [
          {
            date: "2026-07-03",
            status: "failed",
            errorCode: "rate_limited",
            retryAfterMs: 30_000,
          },
        ],
        summary: {
          succeeded: 0,
          failed: 1,
          created: 0,
          changed: 0,
          unchanged: 0,
        },
        nextCursor: "2026-07-03",
        complete: false,
        lastSucceededDate: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "训记",
          description: "Anonymous read-only training source",
        }}
        initialStatus={{
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "同步到今天" }));
    await waitFor(() =>
      expect(screen.getByText(/约 30 秒后重试/)).toBeTruthy(),
    );
    expect(
      (
        screen.getByRole("button", {
          name: /请等待 (30|31) 秒/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("stops the retry timer and re-enables sync when the countdown expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T08:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        provider: "xunji",
        batch: { from: "2026-07-03", to: "2026-07-03" },
        targetDate: "2026-07-04",
        days: [
          {
            date: "2026-07-03",
            status: "failed",
            errorCode: "rate_limited",
            retryAfterMs: 30_000,
          },
        ],
        summary: {
          succeeded: 0,
          failed: 1,
          created: 0,
          changed: 0,
          unchanged: 0,
        },
        nextCursor: "2026-07-03",
        complete: false,
        lastSucceededDate: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "训记",
          description: "Anonymous read-only training source",
        }}
        initialStatus={{
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "同步到今天" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /请等待/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(
      (screen.getByRole("button", { name: "同步到今天" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["succeeded_with_records", "同步成功，已发现训练记录"],
    ["succeeded_empty", "同步成功，本次未读取到训练记录"],
    ["failed", "仅支持 VIP 会员使用"],
  ] as const)("explains the initial automatic outcome %s", (kind, text) => {
    render(
      <IntegrationCard
        trackerKey="anonymous-tracker"
        definition={{
          provider: "xunji",
          displayName: "训记",
          description: "Anonymous read-only training source",
        }}
        initialStatus={{
          ...disconnected,
          configured: true,
          maskedKey: "••••••••",
          sync: {
            ...disconnected.sync,
            status: kind === "failed" ? "failed" : "succeeded",
            lastErrorCode: kind === "failed" ? "membership_required" : null,
            lastOutcome:
              kind === "failed"
                ? { kind, errorCode: "membership_required" }
                : { kind },
          },
        }}
      />,
    );

    expect(screen.getByText(new RegExp(text))).toBeTruthy();
  });
});
