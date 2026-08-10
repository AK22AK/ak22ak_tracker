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

import { RehabAssistantClient } from "@/components/rehab-assistant-client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("date=2026-08-03"),
}));
vi.mock("@/domain/planning-time", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/domain/planning-time")>();
  return { ...original, localDateInTimeZone: () => "2026-08-04" };
});

const turnId = "019c0000-0000-7000-8000-000000000041";
const conversation = {
  schemaVersion: "1.0.0",
  conversationId: "019c0000-0000-7000-8000-000000000042",
  turns: [
    {
      id: turnId,
      commandId: "019c0000-0000-7000-8000-000000000043",
      message: "昨天训练后有点紧。",
      association: { kind: "date", localDate: "2026-08-03" },
      status: "succeeded",
      response: {
        reply: "先确认我整理的反馈。",
        followUpQuestions: [],
        feedbackDraft: {
          localDate: "2026-08-03",
          timing: "post_training",
          leftPain: 1,
          rightPain: 2,
          swelling: "mild",
          stiffness: true,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "匿名反馈",
          association: { kind: "date", localDate: "2026-08-03" },
        },
        planReview: "not_needed",
        memoryActions: [],
        evidenceReferences: [
          { localDate: "2026-08-03", category: "user_message" },
        ],
      },
      errorCode: null,
      model: "deepseek-v4-flash",
      contextHash: "a".repeat(64),
      confirmedFeedbackId: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      completedAt: "2026-08-04T00:00:01.000Z",
    },
  ],
  memories: [],
  profile: null,
  nextCursor: null,
};

function renderAssistant() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RehabAssistantClient />
    </QueryClientProvider>,
  );
}

describe("rehabilitation assistant conversation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps inferred feedback reviewable and sends the user's edited timing and swelling only after confirmation", async () => {
    const localValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              id: "019c0000-0000-7000-8000-000000000044",
              safetyLevel: "yellow",
              replayed: false,
              conversation: {
                ...conversation,
                turns: [
                  {
                    ...conversation.turns[0],
                    confirmedFeedbackId: "019c0000-0000-7000-8000-000000000044",
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(conversation), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderAssistant();
    expect(
      await screen.findByRole("region", { name: "确认身体反馈" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("反馈时机"), {
      target: { value: "next_day" },
    });
    fireEvent.change(screen.getByLabelText("肿胀"), {
      target: { value: "none" },
    });
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "确认并保存反馈" }));

    await waitFor(() => expect(screen.getByText("反馈已保存。")).toBeTruthy());
    const saved = JSON.parse(String(requests.at(-1)?.init?.body));
    expect(saved.feedback.timing).toBe("next_day");
    expect(saved.feedback.swelling).toBe("none");
  });

  it("explains an invalid DeepSeek reply and retries the same canonical turn without changing the user's message", async () => {
    const localValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    });
    const failed = {
      ...conversation,
      turns: [
        {
          ...conversation.turns[0],
          status: "failed",
          response: null,
          errorCode: "invalid_response",
          model: null,
          contextHash: null,
        },
      ],
    };
    const succeeded = {
      ...conversation,
      turns: [
        {
          ...conversation.turns[0],
          response: {
            ...conversation.turns[0].response,
            feedbackDraft: null,
          },
        },
      ],
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify(init?.method === "POST" ? succeeded : failed),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    renderAssistant();
    expect(
      await screen.findByText(
        "DeepSeek 返回的格式不完整，原文已保留，可以直接重试。",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新发送" }));

    await waitFor(() =>
      expect(screen.getByText("先确认我整理的反馈。")).toBeTruthy(),
    );
    const postRequests = requests.filter(({ init }) => init?.method === "POST");
    expect(postRequests).toHaveLength(1);
    expect(JSON.parse(String(postRequests[0]?.init?.body))).toEqual({
      commandId: conversation.turns[0].commandId,
      message: conversation.turns[0].message,
      association: conversation.turns[0].association,
    });
  });
});
