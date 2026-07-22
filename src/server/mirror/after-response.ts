import "server-only";

import { after } from "next/server";

import { consumeOneGitHubMirrorAfterResponse } from "./runtime";

type AfterResponseCallback = () => Promise<void>;

type AfterResponseMirrorOptions = {
  schedule?: (callback: AfterResponseCallback) => void;
  consumeOne?: () => Promise<unknown>;
};

export function scheduleGitHubMirrorAfterResponse(
  options: AfterResponseMirrorOptions = {},
) {
  const schedule = options.schedule ?? after;
  const consumeOne = options.consumeOne ?? consumeOneGitHubMirrorAfterResponse;

  try {
    schedule(async () => {
      try {
        await consumeOne();
      } catch {
        // Core writes are already committed. The outbox lease and retry state
        // remain authoritative when this best-effort attempt cannot complete.
      }
    });
  } catch {
    // Scheduling support must never turn a successful core write into failure.
  }
}
