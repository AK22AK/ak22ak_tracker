import "server-only";

import {
  xunjiSyncRequestSchema,
  xunjiTrainResponseSchema,
  type XunjiTrain,
} from "./contracts";

const xunjiTrainingEndpoint =
  "https://trains.xunjiapp.cn/api_trains_for_llm_v2";

export type XunjiProviderErrorCode =
  | "authentication"
  | "rate_limited"
  | "membership_required"
  | "timeout"
  | "invalid_response"
  | "provider_unavailable";

export class XunjiProviderError extends Error {
  readonly code: XunjiProviderErrorCode;

  constructor(code: XunjiProviderErrorCode, options?: ErrorOptions) {
    super(`xunji_${code}`, options);
    this.name = "XunjiProviderError";
    this.code = code;
  }
}

export type XunjiReadOnlyAdapter = {
  fetchTrainsForDate(input: {
    apiKey: string;
    date: string;
  }): Promise<XunjiTrain[]>;
};

type ProviderBusinessErrorCode = Extract<
  XunjiProviderErrorCode,
  "authentication" | "rate_limited" | "membership_required"
>;

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compactText(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[\s-]+/g, "_")
    : "";
}

function knownBusinessErrorCode(
  values: unknown[],
): ProviderBusinessErrorCode | null {
  const compactValues = values.map(compactText).filter(Boolean);
  if (
    compactValues.some((value) =>
      [
        "apikey_missing",
        "api_key_missing",
        "missing_apikey",
        "missing_api_key",
        "apikey_invalid",
        "api_key_invalid",
        "invalid_apikey",
        "invalid_api_key",
      ].includes(value),
    ) ||
    compactValues.some((value) =>
      /api_?key.*(missing|invalid)|(missing|invalid).*api_?key/.test(value),
    )
  ) {
    return "authentication";
  }
  if (
    compactValues.some((value) =>
      [
        "too_frequent",
        "too_frequent_requests",
        "rate_limited",
        "rate_limit",
        "too_many_requests",
      ].includes(value),
    ) ||
    compactValues.some((value) =>
      /(too_)?frequent|rate_?limit|too_many_requests/.test(value),
    )
  ) {
    return "rate_limited";
  }
  if (
    compactValues.some((value) =>
      [
        "vip_only",
        "only_vip",
        "vip_required",
        "only_vip_available",
        "membership_required",
      ].includes(value),
    ) ||
    compactValues.some((value) =>
      /(only_?vip|vip_?(only|required)|仅.*vip|会员)/.test(value),
    )
  ) {
    return "membership_required";
  }
  return null;
}

function mapBusinessError(payload: unknown): ProviderBusinessErrorCode | null {
  const root = recordValue(payload);
  const candidates = [payload, root?.res];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const mapped = knownBusinessErrorCode([candidate]);
      if (mapped) return mapped;
      continue;
    }
    const value = recordValue(candidate);
    if (!value || value.success !== false) continue;
    const error = recordValue(value.error);
    const mapped = knownBusinessErrorCode([
      value.code,
      value.field,
      value.message,
      error?.code,
      error?.field,
      error?.message,
    ]);
    if (mapped) return mapped;
  }
  return null;
}

export function createXunjiReadOnlyAdapter({
  fetchImpl = fetch,
  timeoutMs = 10_000,
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): XunjiReadOnlyAdapter {
  return {
    async fetchTrainsForDate({ apiKey, date }) {
      const body = xunjiSyncRequestSchema.parse({
        schema_version: "train_open_api_v2",
        datestr: date,
        include_full_data: true,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;

      try {
        response = await fetchImpl(xunjiTrainingEndpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new XunjiProviderError("timeout", { cause: error });
        }
        throw new XunjiProviderError("provider_unavailable", {
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) {
        throw new XunjiProviderError("authentication");
      }
      if (response.status === 429) {
        throw new XunjiProviderError("rate_limited");
      }
      if (!response.ok) {
        throw new XunjiProviderError("provider_unavailable");
      }

      try {
        const payload: unknown = await response.json();
        const businessError = mapBusinessError(payload);
        if (businessError) throw new XunjiProviderError(businessError);
        const trains = xunjiTrainResponseSchema.parse(payload).res.trains;
        if (trains.some((train) => train.datestr !== date)) {
          throw new XunjiProviderError("invalid_response");
        }
        return trains;
      } catch (error) {
        if (error instanceof XunjiProviderError) throw error;
        throw new XunjiProviderError("invalid_response", { cause: error });
      }
    },
  };
}
