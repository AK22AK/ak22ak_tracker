import "server-only";

import type { AiConfigurationStatus } from "@/domain/ai-analysis";
import type { DeepSeekModel } from "@/domain/deepseek-model";

export type DeepSeekRuntimeConfiguration = {
  endpoint: string;
  timeoutMs: number;
  maxTokens: number;
};

export type DeepSeekConfiguration = DeepSeekRuntimeConfiguration & {
  apiKey: string;
  model: DeepSeekModel;
};

const defaults = {
  baseUrl: "https://api.deepseek.com",
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

  const [baseUrl, timeoutInput, maxTokensInput] = values;
  const endpoint = endpointFromBaseUrl(baseUrl);
  const timeoutMs = Number(timeoutInput);
  const maxTokens = Number(maxTokensInput);
  if (
    !endpoint ||
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
    value: { endpoint, timeoutMs, maxTokens },
  };
}

export function createDeepSeekConfiguration(
  runtime: DeepSeekRuntimeConfiguration,
  apiKey: string,
  model: DeepSeekModel,
): DeepSeekConfiguration {
  return { ...runtime, apiKey, model };
}
