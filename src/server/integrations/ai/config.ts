import "server-only";

import { z } from "zod";

import type { AiConfigurationStatus } from "@/domain/ai-analysis";

const modelSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/);

export type DeepSeekConfiguration = {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
};

function endpointFromBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (normalizedPath && normalizedPath !== "/") return null;
    url.pathname = "/chat/completions";
    return url.toString();
  } catch {
    return null;
  }
}

export function readDeepSeekConfiguration(
  environment: Record<string, string | undefined> = process.env,
):
  | { status: "configured"; value: DeepSeekConfiguration }
  | { status: Exclude<AiConfigurationStatus, "configured"> } {
  const names = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_TIMEOUT_MS",
    "DEEPSEEK_MAX_TOKENS",
  ] as const;
  const values = names.map((name) => environment[name]?.trim() ?? "");
  if (values.every((value) => value === "")) {
    return { status: "not_configured" };
  }
  if (values.some((value) => value === "")) {
    return { status: "invalid_configuration" };
  }

  const [apiKey, baseUrl, modelInput, timeoutInput, maxTokensInput] = values;
  const endpoint = endpointFromBaseUrl(baseUrl);
  const model = modelSchema.safeParse(modelInput);
  const timeoutMs = Number(timeoutInput);
  const maxTokens = Number(maxTokensInput);
  if (
    !endpoint ||
    !model.success ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 60_000 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 256 ||
    maxTokens > 8_192
  ) {
    return { status: "invalid_configuration" };
  }
  return {
    status: "configured",
    value: { apiKey, endpoint, model: model.data, timeoutMs, maxTokens },
  };
}
