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
        const trains = xunjiTrainResponseSchema.parse(await response.json()).res
          .trains;
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
