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

import { RehabProfileClient } from "@/components/rehab-profile-client";

const baseConversation = {
  schemaVersion: "1.0.0",
  conversationId: null,
  turns: [],
  memories: [],
  profile: {
    id: "019c0000-0000-7000-8000-000000000011",
    version: 2,
    status: "active",
    document: {
      schemaVersion: "1.0.0",
      goals: ["恢复稳定训练"],
      background: ["匿名康复背景"],
      clinicianGuidance: ["异常时停止并复评"],
      hardConstraints: ["不越过确定性安全规则"],
      trainingPreferences: ["优先可控负荷"],
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    activatedAt: "2026-08-01T00:00:00.000Z",
  },
  nextCursor: null,
};

function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RehabProfileClient />
    </QueryClientProvider>,
  );
}

describe("versioned rehabilitation profile", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the active version and saves a reviewed document without source paths or raw medical material", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              ...baseConversation.profile,
              id: "019c0000-0000-7000-8000-000000000012",
              version: 3,
              document: JSON.parse(String(init.body)),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(baseConversation), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderProfile();
    expect(await screen.findByText("当前版本 2")).toBeTruthy();
    const goals = screen.getByLabelText("康复目标") as HTMLTextAreaElement;
    expect(goals.value).toBe("恢复稳定训练");
    fireEvent.change(goals, {
      target: { value: "恢复稳定训练\n每周保持规律安排" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));

    await waitFor(() =>
      expect(screen.getByText("已保存为版本 3")).toBeTruthy(),
    );
    const saved = JSON.parse(String(requests.at(-1)?.init?.body));
    expect(saved.goals).toEqual(["恢复稳定训练", "每周保持规律安排"]);
    expect(saved).not.toHaveProperty("sourcePath");
    expect(saved).not.toHaveProperty("rawNotes");
  });
});
