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

export async function syncGitHubMirrorBatch() {
  const { configuration, mirror } = resolveGitHubMirrorRuntimeConfig();
  const result =
    configuration === "invalid_configuration"
      ? {
          status: "invalid_configuration" as const,
          processed: 0,
          succeeded: 0,
          failed: 0,
        }
      : await consumeGitHubMirrorBatch({
          store: createNeonGitHubMirrorOutboxStore(),
          mirror,
          leaseOwner: randomUUID(),
          batchSize: 3,
          maxRuntimeMs: 8_000,
        });
  return { result, status: await getGitHubMirrorStatus() };
}
