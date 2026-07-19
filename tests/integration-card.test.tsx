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
        planningTimeZone="Asia/Shanghai"
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
});
