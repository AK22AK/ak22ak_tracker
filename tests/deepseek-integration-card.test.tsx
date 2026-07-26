// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { integrationQueryKeys } from "@/client/query-keys";
import { DeepSeekIntegrationCard } from "@/components/deepseek-integration-card";
import type { DeepSeekConnectionStatus } from "@/domain/deepseek";

const disconnected: DeepSeekConnectionStatus = {
  schemaVersion: "1.0.0",
  provider: "deepseek",
  hasCredential: false,
  state: "not_connected",
  verifiedAt: null,
  updatedAt: null,
  lastErrorCode: null,
};

function renderCard(status: DeepSeekConnectionStatus = disconnected) {
  const queryClient = new QueryClient();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <DeepSeekIntegrationCard
          trackerKey="anonymous-tracker"
          initialStatus={status}
        />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeepSeek private credential card", () => {
  it("clears a validated key and never renders the saved value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...disconnected,
          state: "connected",
          verifiedAt: "2026-07-26T08:00:00.000Z",
          updatedAt: "2026-07-26T08:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    const input = screen.getByLabelText("DeepSeek API Key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "anonymous-candidate-key" } });
    const saveButton = screen.getByRole("button", { name: "验证并保存" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(input.value).toBe(""));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已连接")).toBeTruthy();
    expect(document.body.textContent).not.toContain("anonymous-candidate-key");
  });

  it("keeps the draft and explains safe validation failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "authentication" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ ...disconnected, state: "connected", hasCredential: true });

    const input = screen.getByLabelText(
      "更新 DeepSeek API Key",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "anonymous-invalid-key" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并保存" }));

    await screen.findByText(
      "验证失败，原有连接没有被替换。请检查 API Key 后重试。",
    );
    expect(input.value).toBe("anonymous-invalid-key");
    expect(screen.getByText("已连接")).toBeTruthy();
  });

  it.each([
    ["not_connected", "未连接"],
    ["connected", "已连接"],
    ["needs_update", "需要更新"],
    ["unavailable", "暂时不可用"],
  ] as const)("shows %s as %s", (state, label) => {
    renderCard({ ...disconnected, state });
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("reflects a credential state change from the shared settings cache", async () => {
    const { queryClient } = renderCard({
      ...disconnected,
      hasCredential: true,
      state: "connected",
    });

    act(() => {
      queryClient.setQueryData(
        integrationQueryKeys.providerStatus("anonymous-tracker", "deepseek"),
        {
          ...disconnected,
          hasCredential: true,
          state: "needs_update",
          lastErrorCode: "authentication",
        },
      );
    });

    expect(await screen.findByText("需要更新")).toBeTruthy();
  });
});
