// @vitest-environment jsdom

import {
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

  it("continues bounded server batches without sending a client date or clearing the key draft", async () => {
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
      batch: { from: "2026-07-03", to: "2026-07-04" },
      targetDate: "2026-07-04",
      days: [
        {
          date: "2026-07-03",
          status: "failed",
          errorCode: "rate_limited",
        },
        {
          date: "2026-07-04",
          status: "succeeded",
          cached: false,
          created: 0,
          changed: 0,
          unchanged: 0,
          recordCount: 0,
          syncedAt: "2026-07-04T08:00:01.000Z",
        },
      ],
      summary: {
        succeeded: 1,
        failed: 1,
        created: 0,
        changed: 0,
        unchanged: 0,
      },
      nextCursor: null,
      complete: true,
      lastSucceededDate: "2026-07-04",
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
    fireEvent.click(screen.getByRole("button", { name: "追赶同步至今天" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/成功 3 天，失败 1 天/)).toBeTruthy(),
    );
    expect(keyInput.value).toBe("anonymous-draft-key");
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe(
        "/api/trackers/anonymous-tracker/integrations/xunji/sync",
      );
      expect(request).toEqual(expect.objectContaining({ method: "POST" }));
      expect(request).not.toHaveProperty("body");
    }
  });
});
