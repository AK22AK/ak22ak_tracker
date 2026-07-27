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
  model: "deepseek-v4-flash",
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

  it("persists Pro without replacing the key and links connected users to advice", async () => {
    const connected = {
      ...disconnected,
      model: "deepseek-v4-flash" as const,
      hasCredential: true,
      state: "connected" as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ...connected, model: "deepseek-v4-pro" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderCard(connected);

    fireEvent.change(screen.getByLabelText("建议模型"), {
      target: { value: "deepseek-v4-pro" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "测试当前模型",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存模型" }));

    await screen.findByText("已选择 Pro（更深入）。");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/trackers/anonymous-tracker/integrations/deepseek/preferences",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: "deepseek-v4-pro",
    });
    expect(
      screen
        .getByRole("link", { name: "生成训练调整建议" })
        .getAttribute("href"),
    ).toBe("/trends/advice");
  });

  it("tests the current canonical model once and never exposes a test action while disconnected", async () => {
    const connected = {
      ...disconnected,
      hasCredential: true,
      state: "connected" as const,
    };
    let resolveResponse: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCard(connected);

    const button = screen.getByRole("button", { name: "测试当前模型" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolveResponse!(
      new Response(
        JSON.stringify({
          schemaVersion: "1.0.0",
          model: "deepseek-v4-flash",
          reply: "连接正常",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await screen.findByText("测试成功 · Flash（日常建议）");
    expect(screen.getByText("DeepSeek 回复：连接正常")).toBeTruthy();

    cleanup();
    renderCard();
    expect(screen.queryByRole("button", { name: "测试当前模型" })).toBeNull();
    expect(screen.queryByRole("link", { name: "生成训练调整建议" })).toBeNull();
  });

  it.each([
    ["authentication", "API Key 需要更新，请重新保存后再试。"],
    ["rate_limited", "请求较多，请稍后再试。"],
    ["timeout", "测试超时，请稍后再试。"],
    ["provider_unavailable", "DeepSeek 暂时不可用，请稍后再试。"],
    ["invalid_response", "DeepSeek 返回异常，请稍后再试。"],
  ])("shows only safe test failure copy for %s", async (code, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: code }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderCard({
      ...disconnected,
      hasCredential: true,
      state: "connected",
    });
    fireEvent.click(screen.getByRole("button", { name: "测试当前模型" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(document.body.textContent).not.toContain("provider raw");
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
