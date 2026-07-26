import { describe, expect, it, vi } from "vitest";

import { schemaVersion, type PlanVersion } from "@/domain/schemas";
import {
  createDeepSeekConfiguration,
  readDeepSeekRuntimeConfiguration,
} from "@/server/integrations/ai/config";
import type { PlanAdjustmentContext } from "@/server/integrations/ai/contracts";
import {
  createDeepSeekPlanAdvisor,
  verifyDeepSeekCredential,
} from "@/server/integrations/ai/deepseek";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";

const plan: PlanVersion = {
  schemaVersion,
  id: "019c1000-0000-7000-8000-000000000001",
  trackerKey: "knee-rehab",
  version: 1,
  effectiveFrom: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  createdBy: "import",
  tasks: [
    {
      id: "anonymous-task",
      title: "Anonymous task",
      scheduledDate: "2026-07-24",
      sortOrder: 0,
      category: "training",
      prescription: {},
    },
  ],
};

function context(safetyLevel: "green" | "yellow" | "red" = "green") {
  return {
    currentPlan: plan,
    timelineHeadPlanVersionId: plan.id,
    planningTimeZone: "Asia/Shanghai",
    range: { from: "2026-07-11", through: "2026-07-24" },
    recentFeedback: [],
    confirmedTraining: [],
    recoveryEvidence: [
      {
        localDate: "2026-07-24",
        sleepStatus: "available" as const,
        sleepTotalSeconds: 25_200,
        sleepScore: 78,
        stepsStatus: "available" as const,
        totalSteps: 1_200,
        stepsPartial: true,
      },
    ],
    safetyLevel,
  } satisfies PlanAdjustmentContext;
}

const configuration = {
  apiKey: "anonymous-fake-key",
  endpoint: "https://api.example.invalid/chat/completions",
  model: "anonymous-model",
  timeoutMs: 1_000,
  maxTokens: 1_024,
};

function providerResponse(
  output: unknown,
  finish_reason = "stop",
  extra: Record<string, unknown> = {},
) {
  return new Response(
    JSON.stringify({
      model: "anonymous-model-actual",
      choices: [
        {
          finish_reason,
          message: { content: JSON.stringify(output) },
        },
      ],
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("DeepSeek plan advisor", () => {
  it("keeps the API key out of environment-owned runtime configuration", () => {
    expect(readDeepSeekRuntimeConfiguration({})).toEqual({
      status: "configured",
      value: {
        endpoint: "https://api.deepseek.com/chat/completions",
        model: "deepseek-v4-pro",
        timeoutMs: 15_000,
        maxTokens: 1_800,
      },
    });
    expect(
      readDeepSeekRuntimeConfiguration({
        DEEPSEEK_BASE_URL: "http://api.example.invalid",
      }),
    ).toEqual({ status: "invalid_configuration" });
    expect(
      readDeepSeekRuntimeConfiguration({
        DEEPSEEK_BASE_URL: "https://api.example.invalid",
        DEEPSEEK_MODEL: "model-from-env",
        DEEPSEEK_TIMEOUT_MS: "12000",
        DEEPSEEK_MAX_TOKENS: "1600",
      }),
    ).toEqual({
      status: "configured",
      value: {
        endpoint: "https://api.example.invalid/chat/completions",
        model: "model-from-env",
        timeoutMs: 12_000,
        maxTokens: 1_600,
      },
    });
    expect(
      createDeepSeekConfiguration(
        {
          endpoint: "https://api.example.invalid/chat/completions",
          model: "model-from-env",
          timeoutMs: 12_000,
          maxTokens: 1_600,
        },
        "anonymous-private-key",
      ),
    ).toMatchObject({ apiKey: "anonymous-private-key" });
  });

  it("validates a candidate key with a small anonymous JSON request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse({
        ok: true,
      }),
    );

    await expect(
      verifyDeepSeekCredential(configuration, fetchMock),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(url).toBe(configuration.endpoint);
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer anonymous-fake-key",
      }),
    );
    expect(body.max_tokens).toBeLessThanOrEqual(64);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(JSON.stringify(body)).not.toContain("knee-rehab");
    expect(JSON.stringify(body)).not.toContain("pain");
  });

  it.each([
    [401, "authentication"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
  ])(
    "classifies credential verification HTTP %s as %s",
    async (status, code) => {
      await expect(
        verifyDeepSeekCredential(
          configuration,
          vi.fn().mockResolvedValue(new Response("private", { status })),
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it("rejects an invalid credential verification response", async () => {
    await expect(
      verifyDeepSeekCredential(
        configuration,
        vi
          .fn()
          .mockResolvedValue(
            providerResponse({ ok: true, internal: "not-allowed" }),
          ),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("uses JSON Output and returns a strictly validated proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse({
        summary: "Repeat the current level",
        safetyLevel: "green",
        operations: [],
      }),
    );
    const result = await createDeepSeekPlanAdvisor(
      configuration,
      fetchMock,
    ).proposeAdjustment(context());

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(1_024);
    expect(body.messages[0].content).toContain("json");
    expect(body.messages[0].content).toContain("sleep or steps");
    expect(body.messages[1].content).toContain('"stepsPartial":true');
    for (const forbidden of [
      "sleepStart",
      "sleepEnd",
      "deepSleepSeconds",
      "stepGoal",
      "providerRecordId",
      "syncedAt",
      "tokenBundle",
    ]) {
      expect(body.messages[1].content).not.toContain(forbidden);
    }
    expect(result).toMatchObject({
      safetyLevel: "green",
      operations: [],
      model: "anonymous-model-actual",
    });
  });

  it.each([
    [
      "empty_response",
      "stop",
      { summary: "", safetyLevel: "green", operations: [] },
    ],
    [
      "truncated_response",
      "length",
      { summary: "ok", safetyLevel: "green", operations: [] },
    ],
    [
      "invalid_response",
      "stop",
      { summary: "ok", safetyLevel: "green", operations: [], unknown: true },
    ],
    [
      "unsafe_proposal",
      "stop",
      {
        summary: "replace unknown",
        safetyLevel: "green",
        operations: [
          {
            type: "remove_task",
            taskId: "not-in-plan",
            reason: "anonymous",
          },
        ],
      },
    ],
  ])(
    "classifies %s without returning unvalidated content",
    async (code, finishReason, output) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          code === "empty_response"
            ? providerResponse(output, finishReason).clone()
            : providerResponse(output, finishReason),
        );
      if (code === "empty_response") {
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              model: "anonymous-model",
              choices: [{ finish_reason: "stop", message: { content: "" } }],
            }),
          ),
        );
      }
      await expect(
        createDeepSeekPlanAdvisor(configuration, fetchMock).proposeAdjustment(
          context(),
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it.each([
    [401, "authentication"],
    [402, "insufficient_balance"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
  ])("maps HTTP %s to %s", async (status, code) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("private", { status }));
    await expect(
      createDeepSeekPlanAdvisor(configuration, fetchMock).proposeAdjustment(
        context(),
      ),
    ).rejects.toMatchObject({ code });
  });

  it("maps an aborted request to timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("anonymous", "AbortError"));
    await expect(
      createDeepSeekPlanAdvisor(configuration, fetchMock).proposeAdjustment(
        context(),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PlanAdvisorError>>({ code: "timeout" }),
    );
  });

  it("rejects an oversized provider response before parsing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("x".repeat(256 * 1024 + 1)));
    await expect(
      createDeepSeekPlanAdvisor(configuration, fetchMock).proposeAdjustment(
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not let a model downgrade or prescribe through a red signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse({
        summary: "Increase training",
        safetyLevel: "red",
        operations: [
          {
            type: "remove_task",
            taskId: "anonymous-task",
            reason: "anonymous",
          },
        ],
      }),
    );
    const result = await createDeepSeekPlanAdvisor(
      configuration,
      fetchMock,
    ).proposeAdjustment(context("red"));
    expect(result).toMatchObject({ safetyLevel: "red", operations: [] });
    expect(result.summary).toContain("停止");
  });
});
