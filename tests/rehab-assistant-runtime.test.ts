import { describe, expect, it, vi } from "vitest";

import { createAssistantRuntime } from "@/server/integrations/assistant/runtime";
import { requestRehabAssistantReply } from "@/server/integrations/assistant/deepseek";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";

const trackerId = "019c0000-0000-7000-8000-000000000031";
const turnId = "019c0000-0000-7000-8000-000000000032";
const commandId = "019c0000-0000-7000-8000-000000000033";

function createStore() {
  const failTurn = vi.fn(async () => undefined);
  return {
    failTurn,
    value: {
      requireTracker: vi.fn(async () => ({
        id: trackerId,
        key: "knee-rehab",
        aiContextRevision: 1,
      })),
      findTurn: vi.fn(async () => null),
      createTurn: vi.fn(async () => ({ id: turnId, status: "pending" })),
      claimTurn: vi.fn(async () => true),
      completeTurn: vi.fn(),
      failTurn,
      loadConversation: vi.fn(async () => ({
        schemaVersion: "1.0.0",
        conversationId: null,
        turns: [],
        memories: [],
        profile: null,
        nextCursor: null,
      })),
    },
  };
}

describe("rehabilitation assistant runtime", () => {
  it("rejects reuse of a command id with changed text or association", async () => {
    const store = createStore();
    store.value.findTurn.mockResolvedValue({
      id: turnId,
      status: "succeeded",
      message: "原始问题",
      association: { kind: "date", localDate: "2026-08-03" },
    } as never);
    const runtime = createAssistantRuntime({ store: store.value as never });

    await expect(
      runtime.request("knee-rehab", {
        commandId,
        message: "修改后的问题",
        association: { kind: "date", localDate: "2026-08-03" },
      }),
    ).rejects.toThrow("assistant_command_conflict");
    expect(store.value.createTurn).not.toHaveBeenCalled();
  });

  it("records a truncated provider response distinctly from invalid JSON", async () => {
    const store = createStore();
    const runtime = createAssistantRuntime({
      store: store.value as never,
      prepareContext: vi.fn(
        async () =>
          ({
            contextVersion: "3",
            contextHash: "a".repeat(64),
            profileVersion: null,
            memoryHash: "b".repeat(64),
            modelContext: {},
            base: { contextRevision: 1, contextThrough: "2026-08-04" },
          }) as never,
      ),
      resolveConfiguration: vi.fn(async () => ({
        status: "configured" as const,
        value: {
          endpoint: "https://example.invalid",
          apiKey: "fake",
          model: "deepseek-v4-flash" as const,
          timeoutMs: 1000,
          maxTokens: 1000,
        },
      })),
      requestReply: vi.fn(async () => {
        throw new PlanAdvisorError("truncated_response");
      }),
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });

    await runtime.request("knee-rehab", {
      commandId,
      message: "匿名问题",
      association: { kind: "auto" },
    });

    expect(store.failTurn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "truncated_response" }),
    );
  });

  it("allows at most one explicitly bounded historical lookup of 30 days", async () => {
    const providerOutputs = [
      {
        reply: "需要查看一段明确历史。",
        followUpQuestions: [],
        feedbackDraft: null,
        planReview: "not_needed",
        memoryActions: [],
        evidenceReferences: [],
        historyRequest: {
          from: "2026-07-01",
          through: "2026-07-30",
          reason: "核对稳定训练规律",
        },
      },
      {
        reply: "历史记录已足够，先保持当前安排。",
        followUpQuestions: [],
        feedbackDraft: null,
        planReview: "not_needed",
        memoryActions: [],
        evidenceReferences: [],
        historyRequest: null,
      },
    ];
    const fetchImpl = vi.fn(async () => {
      const output = providerOutputs.shift();
      return new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(output) },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const loadHistory = vi.fn(async () => [{ localDate: "2026-07-01" }]);

    const response = await requestRehabAssistantReply({
      configuration: {
        endpoint: "https://example.invalid",
        apiKey: "fake",
        model: "deepseek-v4-flash",
        timeoutMs: 1_000,
        maxTokens: 1_000,
      },
      context: {
        base: { contextThrough: "2026-08-04" },
        modelContext: { currentPlan: { tasks: [] } },
      } as never,
      message: "过去一个月有什么规律？",
      loadHistory,
      fetchImpl: fetchImpl as never,
    });

    expect(response.reply).toContain("保持当前安排");
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledWith({
      from: "2026-07-01",
      through: "2026-07-30",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("provides a complete JSON example for complex rehabilitation replies", async () => {
    let systemMessage = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      systemMessage = body.messages[0].content;
      return new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  reply: "先结合近期记录确认训练安排。",
                  followUpQuestions: [],
                  feedbackDraft: null,
                  planReview: "suggested",
                  memoryActions: [],
                  evidenceReferences: [
                    {
                      localDate: "2026-08-04",
                      category: "user_message",
                    },
                  ],
                  historyRequest: null,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await requestRehabAssistantReply({
      configuration: {
        endpoint: "https://example.invalid",
        apiKey: "fake",
        model: "deepseek-v4-flash",
        timeoutMs: 1_000,
        maxTokens: 1_000,
      },
      context: {
        base: { contextThrough: "2026-08-04" },
        modelContext: { currentPlan: { tasks: [] } },
      } as never,
      message: "请结合近期训练和新的时间安排检查计划。",
      loadHistory: vi.fn(),
      fetchImpl: fetchImpl as never,
    });

    expect(systemMessage).toContain("EXAMPLE JSON OUTPUT");
    expect(systemMessage).toContain('"followUpQuestions":[]');
    expect(systemMessage).toContain('"feedbackDraft":null');
    expect(systemMessage).toContain('"planReview":"suggested"');
    expect(systemMessage).toContain('"memoryActions"');
    expect(systemMessage).toContain('"evidenceReferences"');
    expect(systemMessage).toContain('"historyRequest":null');
  });

  it("safely defaults omitted non-action fields while keeping reply required", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "deepseek-v4-flash",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    reply: "近期记录已收到，先补充一个训练后的身体反应。",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await expect(
      requestRehabAssistantReply({
        configuration: {
          endpoint: "https://example.invalid",
          apiKey: "fake",
          model: "deepseek-v4-flash",
          timeoutMs: 1_000,
          maxTokens: 1_000,
        },
        context: {
          base: { contextThrough: "2026-08-04" },
          modelContext: { currentPlan: { tasks: [] } },
        } as never,
        message: "匿名复杂问题",
        loadHistory: vi.fn(),
        fetchImpl: fetchImpl as never,
      }),
    ).resolves.toEqual({
      reply: "近期记录已收到，先补充一个训练后的身体反应。",
      followUpQuestions: [],
      feedbackDraft: null,
      planReview: "blocked_by_missing_info",
      memoryActions: [],
      evidenceReferences: [],
    });
  });

  it("logs only a safe validation stage and field path for invalid provider output", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "deepseek-v4-flash",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    reply: "private provider reply must not appear in logs",
                    planReview: "change_the_plan_now",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await expect(
      requestRehabAssistantReply({
        configuration: {
          endpoint: "https://example.invalid",
          apiKey: "fake",
          model: "deepseek-v4-flash",
          timeoutMs: 1_000,
          maxTokens: 1_000,
        },
        context: {
          base: { contextThrough: "2026-08-04" },
          modelContext: { currentPlan: { tasks: [] } },
        } as never,
        message: "private user message must not appear in logs",
        loadHistory: vi.fn(),
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    expect(warning).toHaveBeenCalledWith(
      "assistant_provider_invalid_response",
      expect.objectContaining({
        stage: "output_schema",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "planReview" }),
        ]),
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      "private provider reply",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      "private user message",
    );
  });
});
