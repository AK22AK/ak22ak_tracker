// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantMemoriesClient } from "@/components/assistant-memories-client";

function conversation(content = "家里有弹力带") {
  return {
    schemaVersion: "1.0.0",
    conversationId: null,
    turns: [],
    memories: [
      {
        id: "019c0000-0000-7000-8000-000000000021",
        category: "equipment",
        content,
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "019c0000-0000-7000-8000-000000000022",
        category: "goal",
        content: "已删除目标",
        status: "deleted",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    profile: null,
    nextCursor: null,
  };
}

function renderMemories() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssistantMemoriesClient />
    </QueryClientProvider>,
  );
}

describe("assistant memory management", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows only active stable memories and lets the user edit one", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify(body ? conversation(body.content) : conversation()),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    renderMemories();
    expect(await screen.findByDisplayValue("家里有弹力带")).toBeTruthy();
    expect(screen.queryByText("已删除目标")).toBeNull();
    fireEvent.change(screen.getByLabelText("记忆内容"), {
      target: { value: "家里有弹力带和瑜伽垫" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("记忆已更新")).toBeTruthy());
    expect(requests.at(-1)?.init?.method).toBe("PUT");
    expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({
      category: "equipment",
      content: "家里有弹力带和瑜伽垫",
    });
  });

  it("requires a second explicit action before deleting a memory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Response(
            JSON.stringify(
              init?.method === "DELETE"
                ? { ...conversation(), memories: [] }
                : conversation(),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    renderMemories();
    await screen.findByDisplayValue("家里有弹力带");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText("确定删除这条记忆？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(screen.getByText("还没有助手记忆")).toBeTruthy(),
    );
  });
});
