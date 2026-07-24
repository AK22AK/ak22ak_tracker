import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  garminActivityRecoveryResponseSchema,
  garminDailyRecoveryCronResponseSchema,
  garminProviderErrorCodeSchema,
} from "@/domain/garmin";

import { createDefaultGarminRuntime } from "./runtime";

type GarminRecoveryRuntime = {
  recoverActivityHistory(input: {
    trackerKey: "knee-rehab";
    profile: "daily_cron";
  }): Promise<unknown>;
};

type GarminRecoveryCronDependencies = {
  readSecret?: () => string | undefined;
  createRuntime?: () => GarminRecoveryRuntime;
};

function authorized(authorization: string | null, secret: string) {
  if (!authorization) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createGarminRecoveryCronHandler(
  dependencies: GarminRecoveryCronDependencies = {},
) {
  const readSecret = dependencies.readSecret ?? (() => process.env.CRON_SECRET);
  const createRuntime =
    dependencies.createRuntime ?? (() => createDefaultGarminRuntime());

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
      const recovery = garminActivityRecoveryResponseSchema.parse(
        await createRuntime().recoverActivityHistory({
          trackerKey: "knee-rehab",
          profile: "daily_cron",
        }),
      );
      const result =
        recovery.status === "skipped"
          ? { status: "skipped" as const, reason: recovery.reason }
          : {
              status: "completed" as const,
              sync: {
                batch: recovery.sync.batch,
                targetDate: recovery.sync.targetDate,
                summary: recovery.sync.summary,
                nextCursor: recovery.sync.nextCursor,
                complete: recovery.sync.complete,
                lastSucceededDate: recovery.sync.lastSucceededDate,
                errorCode:
                  recovery.sync.days.find((day) => day.status === "failed")
                    ?.errorCode ?? null,
              },
            };
      if (result.status === "completed" && result.sync.errorCode !== null) {
        result.sync.errorCode = garminProviderErrorCodeSchema.parse(
          result.sync.errorCode,
        );
      }
      return Response.json(
        garminDailyRecoveryCronResponseSchema.parse(result),
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
