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

function configuredMirror() {
  try {
    const config = readGitHubMirrorConfig();
    return config ? createGitHubContentsMirror(config) : null;
  } catch (error) {
    if (error instanceof GitHubMirrorError) return null;
    throw error;
  }
}

export async function getGitHubMirrorStatus() {
  const configured = configuredMirror() !== null;
  return githubMirrorStatusSchema.parse(
    await getGitHubMirrorStatusProjection(configured),
  );
}

export async function syncGitHubMirrorBatch() {
  const mirror = configuredMirror();
  const result = await consumeGitHubMirrorBatch({
    store: createNeonGitHubMirrorOutboxStore(),
    mirror,
    leaseOwner: randomUUID(),
    batchSize: 3,
    maxRuntimeMs: 8_000,
  });
  return { result, status: await getGitHubMirrorStatus() };
}
