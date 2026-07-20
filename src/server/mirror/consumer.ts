import "server-only";

import type { GitHubContentsMirror, GitHubMirrorErrorCode } from "./github";
import { GitHubMirrorError } from "./github";

export type GitHubMirrorOutboxItem = {
  id: string;
  targetPath: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type GitHubMirrorOutboxStore = {
  claimNext(input: {
    leaseOwner: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<GitHubMirrorOutboxItem | null>;
  markSucceeded(id: string, leaseOwner: string, now: Date): Promise<boolean>;
  markRetryable(
    id: string,
    leaseOwner: string,
    errorCode: GitHubMirrorErrorCode,
    nextAttemptAt: Date,
  ): Promise<boolean>;
  markFailed(
    id: string,
    leaseOwner: string,
    errorCode: GitHubMirrorErrorCode | "retry_exhausted",
  ): Promise<boolean>;
};

export type GitHubMirrorBatchResult = {
  status:
    | "not_configured"
    | "invalid_configuration"
    | "idle"
    | "succeeded"
    | "retry_scheduled"
    | "needs_attention"
    | "unconfirmed";
  processed: number;
  succeeded: number;
  failed: number;
};

function backoffDelayMs(attempts: number) {
  const exponent = Math.min(Math.max(attempts, 0), 8);
  return Math.min(30_000 * 2 ** exponent, 6 * 60 * 60 * 1_000);
}

export async function consumeGitHubMirrorBatch(input: {
  store: GitHubMirrorOutboxStore;
  mirror: Pick<GitHubContentsMirror, "putJson"> | null;
  leaseOwner: string;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  maxRuntimeMs?: number;
  now?: () => Date;
}): Promise<GitHubMirrorBatchResult> {
  if (!input.mirror) {
    return { status: "not_configured", processed: 0, succeeded: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(input.batchSize ?? 3, 10));
  const leaseMs = input.leaseMs ?? 30_000;
  const maxAttempts = input.maxAttempts ?? 10;
  const maxRuntimeMs = input.maxRuntimeMs ?? 8_000;
  const now = input.now ?? (() => new Date());
  const startedAt = now().getTime();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let status: GitHubMirrorBatchResult["status"] = "idle";

  while (processed < batchSize && now().getTime() - startedAt <= maxRuntimeMs) {
    const claimedAt = now();
    const outbox = await input.store.claimNext({
      leaseOwner: input.leaseOwner,
      now: claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + leaseMs),
    });
    if (!outbox) break;
    processed += 1;
    try {
      await input.mirror.putJson(outbox.targetPath, outbox.payload);
      const transitioned = await input.store.markSucceeded(
        outbox.id,
        input.leaseOwner,
        now(),
      );
      if (!transitioned) {
        status = "unconfirmed";
        break;
      }
      succeeded += 1;
      status = "succeeded";
    } catch (error) {
      const mirrorError =
        error instanceof GitHubMirrorError
          ? error
          : new GitHubMirrorError("github_unavailable", true);
      if (mirrorError.retryable && outbox.attempts + 1 < maxAttempts) {
        const nextAttemptAt = new Date(
          now().getTime() + backoffDelayMs(outbox.attempts),
        );
        const transitioned = await input.store.markRetryable(
          outbox.id,
          input.leaseOwner,
          mirrorError.code,
          nextAttemptAt,
        );
        if (!transitioned) {
          status = "unconfirmed";
          break;
        }
        failed += 1;
        status = "retry_scheduled";
      } else {
        const transitioned = await input.store.markFailed(
          outbox.id,
          input.leaseOwner,
          mirrorError.retryable ? "retry_exhausted" : mirrorError.code,
        );
        if (!transitioned) {
          status = "unconfirmed";
          break;
        }
        failed += 1;
        status = "needs_attention";
      }
      break;
    }
  }
  return { status, processed, succeeded, failed };
}
