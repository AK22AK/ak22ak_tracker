import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { planTaskSchema, type PlanChangeOperation } from "@/domain/schemas";

import type {
  PlanAdjustmentContext,
  PlanAdvisor,
  PlanAdvisorProposal,
} from "./contracts";
import type { DeepSeekConfiguration } from "./config";
import { PlanAdvisorError } from "./errors";

const strictPlanTaskSchema = planTaskSchema.strict();
const strictOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add_task"),
      task: strictPlanTaskSchema,
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("replace_task"),
      taskId: z.string().min(1).max(120),
      task: strictPlanTaskSchema,
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("remove_task"),
      taskId: z.string().min(1).max(120),
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_plan_note"),
      note: z.string().max(10_000),
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
]);

const advisorOutputSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    safetyLevel: z.enum(["green", "yellow", "red"]),
    operations: z.array(strictOperationSchema).max(20),
  })
  .strict();

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

const MAX_RESPONSE_BYTES = 256 * 1024;

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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safetyRank(level: "green" | "yellow" | "red") {
  return { green: 0, yellow: 1, red: 2 }[level];
}

function validateOperations(
  context: PlanAdjustmentContext,
  operations: PlanChangeOperation[],
) {
  const existing = new Set(context.currentPlan.tasks.map((task) => task.id));
  const added = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "replace_task") {
      if (
        !existing.has(operation.taskId) ||
        operation.task.id !== operation.taskId
      ) {
        throw new PlanAdvisorError("unsafe_proposal");
      }
    }
    if (operation.type === "remove_task" && !existing.has(operation.taskId)) {
      throw new PlanAdvisorError("unsafe_proposal");
    }
    if (operation.type === "add_task") {
      if (existing.has(operation.task.id) || added.has(operation.task.id)) {
        throw new PlanAdvisorError("unsafe_proposal");
      }
      added.add(operation.task.id);
    }
    if (
      (operation.type === "add_task" || operation.type === "replace_task") &&
      operation.task.scheduledDate < context.range.through
    ) {
      throw new PlanAdvisorError("unsafe_proposal");
    }
  }
}

function systemPrompt() {
  return `You produce a conservative rehabilitation plan suggestion as strict json.\n\
Return exactly this JSON shape and no other fields:\n\
{"summary":"short user-facing summary","safetyLevel":"green|yellow|red","operations":[{"type":"add_task|replace_task|remove_task|set_plan_note", "...":"fields matching the example"}]}\n\
Only use the supplied structured context. Do not diagnose, infer medical imaging changes, call tools, or claim causation. Change at most one load variable at a time. If evidence is insufficient, return no operations. Never reduce the supplied safety level.`;
}

function requestBody(
  configuration: DeepSeekConfiguration,
  context: PlanAdjustmentContext,
) {
  return {
    model: configuration.model,
    stream: false,
    response_format: { type: "json_object" },
    max_tokens: configuration.maxTokens,
    messages: [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `Analyze this JSON context and return JSON only:\n${JSON.stringify(context)}`,
      },
    ],
  };
}

function classifyHttpStatus(status: number) {
  if (status === 401 || status === 403) return "authentication" as const;
  if (status === 402) return "insufficient_balance" as const;
  if (status === 429) return "rate_limited" as const;
  if (status >= 500) return "provider_unavailable" as const;
  return "invalid_response" as const;
}

export function createDeepSeekPlanAdvisor(
  configuration: DeepSeekConfiguration,
  fetchImpl: typeof fetch = fetch,
): PlanAdvisor {
  return {
    async proposeAdjustment(context): Promise<PlanAdvisorProposal> {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        configuration.timeoutMs,
      );
      let response: Response;
      try {
        response = await fetchImpl(configuration.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${configuration.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody(configuration, context)),
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
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_RESPONSE_BYTES
      ) {
        throw new PlanAdvisorError("invalid_response");
      }
      const raw = await readBoundedBody(response);
      let parsedResponse: z.infer<typeof chatResponseSchema>;
      try {
        parsedResponse = chatResponseSchema.parse(JSON.parse(raw));
      } catch (error) {
        throw new PlanAdvisorError("invalid_response", { cause: error });
      }
      const choice = parsedResponse.choices[0]!;
      if (choice.finish_reason === "length") {
        throw new PlanAdvisorError("truncated_response");
      }
      if (choice.finish_reason !== "stop") {
        throw new PlanAdvisorError("invalid_response");
      }
      const content = choice.message.content?.trim();
      if (!content) throw new PlanAdvisorError("empty_response");
      let output: z.infer<typeof advisorOutputSchema>;
      try {
        output = advisorOutputSchema.parse(JSON.parse(content));
      } catch (error) {
        throw new PlanAdvisorError("invalid_response", { cause: error });
      }
      validateOperations(context, output.operations);

      if (context.safetyLevel === "red") {
        return {
          summary: "当前记录出现红灯信号，请停止相关训练并重新评估。",
          safetyLevel: "red",
          operations: [],
          model: parsedResponse.model,
          responseHash: sha256(content),
        };
      }
      if (safetyRank(output.safetyLevel) < safetyRank(context.safetyLevel)) {
        throw new PlanAdvisorError("unsafe_proposal");
      }
      return {
        ...output,
        model: parsedResponse.model,
        responseHash: sha256(content),
      };
    },
  };
}
