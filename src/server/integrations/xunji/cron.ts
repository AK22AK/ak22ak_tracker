import "server-only";

import { timingSafeEqual } from "node:crypto";

import { integrationRecoveryResponseSchema } from "@/domain/integrations";

import { recoverXunjiHistory } from "./runtime";

function authorized(value: string | null, secret: string) {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createXunjiRecoveryCronHandler(
  dependencies: {
    readSecret?: () => string | undefined;
    recover?: typeof recoverXunjiHistory;
  } = {},
) {
  const readSecret = dependencies.readSecret ?? (() => process.env.CRON_SECRET);
  const recover = dependencies.recover ?? recoverXunjiHistory;
  return async function GET(request: Request) {
    const secret = readSecret();
    if (!secret) {
      return Response.json(
        { status: "unavailable", reason: "not_configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!authorized(request.headers.get("authorization"), secret)) {
      return Response.json(
        { status: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      return Response.json(
        integrationRecoveryResponseSchema.parse(
          await recover({ trackerKey: "knee-rehab", batchSize: 3 }),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return Response.json(
        { status: "unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
