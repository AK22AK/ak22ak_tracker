import "server-only";

import { timingSafeEqual } from "node:crypto";

import { githubMirrorSyncResponseSchema } from "@/domain/github-mirror";

import { syncGitHubMirrorBatch } from "./runtime";

type GitHubMirrorCronDependencies = {
  readSecret?: () => string | undefined;
  sync?: () => Promise<unknown>;
};

function authorized(authorization: string | null, secret: string | undefined) {
  if (!authorization || !secret) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createGitHubMirrorCronHandler(
  dependencies: GitHubMirrorCronDependencies = {},
) {
  const readSecret = dependencies.readSecret ?? (() => process.env.CRON_SECRET);
  const sync = dependencies.sync ?? syncGitHubMirrorBatch;

  return async function GET(request: Request) {
    if (!authorized(request.headers.get("authorization"), readSecret())) {
      return Response.json(
        { status: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const result = githubMirrorSyncResponseSchema.parse(await sync());
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return Response.json(
        { status: "unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
