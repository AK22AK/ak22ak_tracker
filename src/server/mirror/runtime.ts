import "server-only";

import { randomUUID } from "node:crypto";

import { githubMirrorStatusSchema } from "@/domain/github-mirror";

import { consumeGitHubMirrorBatch } from "./consumer";
import {
  createGitHubContentsMirror,
  GitHubMirrorError,
  readGitHubMirrorConfig,
} from "./github";
import {
  createNeonGitHubMirrorOutboxStore,
  getGitHubMirrorStatusProjection,
} from "./neon-outbox-store";
import type { GitHubMirrorOutboxStore } from "./consumer";

export function resolveGitHubMirrorRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  try {
    const config = readGitHubMirrorConfig(environment);
    return config
      ? {
          configuration: "configured" as const,
          mirror: createGitHubContentsMirror(config),
        }
      : { configuration: "not_configured" as const, mirror: null };
  } catch (error) {
    if (error instanceof GitHubMirrorError) {
      return { configuration: "invalid_configuration" as const, mirror: null };
    }
    throw error;
  }
}

export async function getGitHubMirrorStatus() {
  const { configuration } = resolveGitHubMirrorRuntimeConfig();
  return githubMirrorStatusSchema.parse(
    await getGitHubMirrorStatusProjection(configuration),
  );
}

type SyncGitHubMirrorBatchOptions = {
  resolveConfig?: typeof resolveGitHubMirrorRuntimeConfig;
  store?: GitHubMirrorOutboxStore;
  leaseOwner?: string;
  getStatus?: typeof getGitHubMirrorStatus;
  now?: () => Date;
};

export async function syncGitHubMirrorBatch(
  options: SyncGitHubMirrorBatchOptions = {},
) {
  const { configuration, mirror } = (
    options.resolveConfig ?? resolveGitHubMirrorRuntimeConfig
  )();
  const result =
    configuration === "invalid_configuration"
      ? {
          status: "invalid_configuration" as const,
          processed: 0,
          succeeded: 0,
          failed: 0,
        }
      : await consumeGitHubMirrorBatch({
          store: options.store ?? createNeonGitHubMirrorOutboxStore(),
          mirror,
          leaseOwner: options.leaseOwner ?? randomUUID(),
          batchSize: 3,
          maxRuntimeMs: 8_000,
          now: options.now,
        });
  return {
    result,
    status: await (options.getStatus ?? getGitHubMirrorStatus)(),
  };
}

type ConsumeOneGitHubMirrorOptions = {
  resolveConfig?: typeof resolveGitHubMirrorRuntimeConfig;
  store?: GitHubMirrorOutboxStore;
  leaseOwner?: string;
};

export async function consumeOneGitHubMirrorAfterResponse(
  options: ConsumeOneGitHubMirrorOptions = {},
) {
  const { configuration, mirror } = (
    options.resolveConfig ?? resolveGitHubMirrorRuntimeConfig
  )();
  if (configuration !== "configured" || !mirror) {
    return {
      status: configuration,
      processed: 0,
      succeeded: 0,
      failed: 0,
    } as const;
  }
  return consumeGitHubMirrorBatch({
    store: options.store ?? createNeonGitHubMirrorOutboxStore(),
    mirror,
    leaseOwner: options.leaseOwner ?? randomUUID(),
    batchSize: 1,
    maxRuntimeMs: 8_000,
  });
}
