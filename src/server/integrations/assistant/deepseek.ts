import "server-only";

import { z } from "zod";

import {
  assistantTurnResponseSchema,
  type AssistantTurnResponse,
} from "@/domain/rehab-assistant";
import type { DeepSeekConfiguration } from "@/server/integrations/ai/config";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";

import type { PreparedAssistantContext } from "./context";

const providerOutputSchema = assistantTurnResponseSchema.extend({
  followUpQuestions:
    assistantTurnResponseSchema.shape.followUpQuestions.default([]),
  feedbackDraft: assistantTurnResponseSchema.shape.feedbackDraft.default(null),
  planReview: assistantTurnResponseSchema.shape.planReview.default(
    "blocked_by_missing_info",
  ),
  memoryActions: assistantTurnResponseSchema.shape.memoryActions.default([]),
  evidenceReferences:
    assistantTurnResponseSchema.shape.evidenceReferences.default([]),
  historyRequest: z
    .object({
      from: z.string().date(),
      through: z.string().date(),
      reason: z.string().min(1).max(500),
    })
    .strict()
    .nullable()
    .default(null),
});

const chatResponseSchema = z
  .object({
    model: z.string().min(1).max(120),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.enum([
              "stop",
              "length",
              "content_filter",
              "tool_calls",
              "insufficient_system_resource",
            ]),
            message: z.object({ content: z.string().nullable() }).passthrough(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

const MAX_RESPONSE_BYTES = 128 * 1024;

function reportInvalidProviderResponse(stage: string, error?: z.ZodError) {
  console.warn("assistant_provider_invalid_response", {
    stage,
    issues: error?.issues.slice(0, 20).map((issue) => ({
      code: issue.code,
      path: issue.path.join("."),
    })),
  });
}

function systemPrompt(today: string) {
  return `You are a conservative rehabilitation assistant. Today is ${today}.
Return strict JSON only. Use exactly these fields: reply, followUpQuestions, feedbackDraft, planReview, memoryActions, evidenceReferences, historyRequest.
EXAMPLE JSON OUTPUT:
{"reply":"先结合近期记录确认训练安排。","followUpQuestions":[],"feedbackDraft":null,"planReview":"suggested","memoryActions":[{"type":"remember","category":"schedule","content":"工作日中午可进行力量训练"}],"evidenceReferences":[{"localDate":"${today}","category":"user_message"}],"historyRequest":null}
If feedbackDraft is not null, use exactly this shape:
{"localDate":"${today}","timing":"morning|post_training|next_day|incident","leftPain":0,"rightPain":0,"swelling":"none|mild|obvious","stiffness":false,"mechanicalSymptoms":false,"weightBearingIssue":false,"localizedBonePain":false,"nightOrRestPain":false,"note":"reviewable user observation","association":{"kind":"auto"}}
If historyRequest is not null, use exactly {"from":"YYYY-MM-DD","through":"YYYY-MM-DD","reason":"why older evidence is needed"}. The supplied context already contains the most recent 14 days, so never request a range fully contained in those dates. Request at most one older range of no more than 30 days.
planReview must be exactly not_needed, suggested, or blocked_by_missing_info. memoryActions items must use type remember|forget and category goal|preference|schedule|equipment|routine|stable_constraint. Every evidenceReferences category must be exactly one of user_message|plan|feedback|planned_task|garmin_activity|xunji_training|recovery|memory|rehab_profile.
Never diagnose, reinterpret medical imaging, or claim causation. Deterministic safety rules outrank you. Ordinary conversation cannot modify the plan. A feedbackDraft is only a reviewable draft and is never saved automatically. Infer dates conservatively and never return a future localDate. Use memory only for stable goals, preferences, schedules, equipment, routines, or stable constraints; never store temporary symptoms, diagnoses, safety policy, or plan changes. Otherwise historyRequest must be null. Never expose database IDs or provider IDs.`;
}

function classifyHttpStatus(status: number) {
  if (status === 401 || status === 403) return "authentication" as const;
  if (status === 402) return "insufficient_balance" as const;
  if (status === 429) return "rate_limited" as const;
  if (status >= 500) return "provider_unavailable" as const;
  return "invalid_response" as const;
}

async function readBoundedBody(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let value = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PlanAdvisorError("invalid_response");
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value + decoder.decode();
}

async function callDeepSeek(
  configuration: DeepSeekConfiguration,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fetchImpl: typeof fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(configuration.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.model,
        stream: false,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: Math.min(configuration.maxTokens, 2_048),
        messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new PlanAdvisorError(
      error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : "provider_unavailable",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new PlanAdvisorError(classifyHttpStatus(response.status));
  }
  const raw = await readBoundedBody(response);
  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(raw);
  } catch (error) {
    reportInvalidProviderResponse("envelope_json");
    throw new PlanAdvisorError("invalid_response", { cause: error });
  }
  const envelopeResult = chatResponseSchema.safeParse(parsedEnvelope);
  if (!envelopeResult.success) {
    reportInvalidProviderResponse("envelope_schema", envelopeResult.error);
    throw new PlanAdvisorError("invalid_response", {
      cause: envelopeResult.error,
    });
  }
  const envelope = envelopeResult.data;
  const choice = envelope.choices[0]!;
  if (envelope.model !== configuration.model) {
    reportInvalidProviderResponse("model_mismatch");
    throw new PlanAdvisorError("invalid_response");
  }
  if (choice.finish_reason === "length") {
    throw new PlanAdvisorError("truncated_response");
  }
  const content = choice.message.content?.trim();
  if (choice.finish_reason === "stop" && !content) {
    throw new PlanAdvisorError("empty_response");
  }
  if (choice.finish_reason !== "stop") {
    reportInvalidProviderResponse("finish_reason");
    throw new PlanAdvisorError("invalid_response");
  }
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content!);
  } catch (error) {
    reportInvalidProviderResponse("content_json");
    throw new PlanAdvisorError("invalid_response", { cause: error });
  }
  const outputResult = providerOutputSchema.safeParse(parsedContent);
  if (!outputResult.success) {
    reportInvalidProviderResponse("output_schema", outputResult.error);
    throw new PlanAdvisorError("invalid_response", {
      cause: outputResult.error,
    });
  }
  return outputResult.data;
}

function rangeDays(from: string, through: string) {
  const start = new Date(`${from}T00:00:00.000Z`).valueOf();
  const end = new Date(`${through}T00:00:00.000Z`).valueOf();
  return Math.floor((end - start) / 86_400_000) + 1;
}

export async function requestRehabAssistantReply({
  configuration,
  context,
  message,
  loadHistory,
  fetchImpl = fetch,
}: {
  configuration: DeepSeekConfiguration;
  context: PreparedAssistantContext;
  message: string;
  loadHistory: (range: { from: string; through: string }) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}): Promise<AssistantTurnResponse> {
  const baseMessages = [
    {
      role: "system" as const,
      content: systemPrompt(context.base.contextThrough),
    },
    {
      role: "user" as const,
      content: `Context JSON:\n${JSON.stringify(context.modelContext)}\n\nCurrent user message:\n${message}`,
    },
  ];
  const first = await callDeepSeek(configuration, baseMessages, fetchImpl);
  if (!first.historyRequest) {
    const { historyRequest, ...response } = first;
    void historyRequest;
    return assistantTurnResponseSchema.parse(response);
  }
  const request = first.historyRequest;
  const days = rangeDays(request.from, request.through);
  if (days < 1 || days > 30 || request.through > context.base.contextThrough) {
    throw new PlanAdvisorError("invalid_response");
  }
  const historicalEvidence = await loadHistory({
    from: request.from,
    through: request.through,
  });
  const second = await callDeepSeek(
    configuration,
    [
      ...baseMessages,
      { role: "assistant", content: JSON.stringify(first) },
      {
        role: "user",
        content: `One bounded historical lookup result:\n${JSON.stringify(historicalEvidence)}\nReturn the final strict JSON now with historyRequest null.`,
      },
    ],
    fetchImpl,
  );
  if (second.historyRequest !== null) {
    throw new PlanAdvisorError("invalid_response");
  }
  const { historyRequest, ...response } = second;
  void historyRequest;
  return assistantTurnResponseSchema.parse(response);
}
