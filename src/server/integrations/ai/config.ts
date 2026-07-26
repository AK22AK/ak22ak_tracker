import "server-only";

import { z } from "zod";

import type { AiConfigurationStatus } from "@/domain/ai-analysis";

const modelSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/);

export type DeepSeekRuntimeConfiguration = {
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
};

export type DeepSeekConfiguration = DeepSeekRuntimeConfiguration & {
  apiKey: string;
};

const defaults = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  timeoutMs: "15000",
  maxTokens: "1800",
} as const;

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

export function readDeepSeekRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
):
  | { status: "configured"; value: DeepSeekRuntimeConfiguration }
  | { status: Exclude<AiConfigurationStatus, "configured"> } {
  const values = [
    environment.DEEPSEEK_BASE_URL === undefined
      ? defaults.baseUrl
      : environment.DEEPSEEK_BASE_URL.trim(),
    environment.DEEPSEEK_MODEL === undefined
      ? defaults.model
      : environment.DEEPSEEK_MODEL.trim(),
    environment.DEEPSEEK_TIMEOUT_MS === undefined
      ? defaults.timeoutMs
      : environment.DEEPSEEK_TIMEOUT_MS.trim(),
    environment.DEEPSEEK_MAX_TOKENS === undefined
      ? defaults.maxTokens
      : environment.DEEPSEEK_MAX_TOKENS.trim(),
  ];
  if (values.some((value) => value === "")) {
    return { status: "invalid_configuration" };
  }

  const [baseUrl, modelInput, timeoutInput, maxTokensInput] = values;
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
    value: { endpoint, model: model.data, timeoutMs, maxTokens },
  };
}

export function createDeepSeekConfiguration(
  runtime: DeepSeekRuntimeConfiguration,
  apiKey: string,
): DeepSeekConfiguration {
  return { ...runtime, apiKey };
}
