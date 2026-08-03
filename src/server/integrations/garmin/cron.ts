import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  garminActivityRecoveryResponseSchema,
  garminDailyRecoveryCronResponseSchema,
  garminProviderErrorCodeSchema,
  garminWellnessRecoveryResponseSchema,
} from "@/domain/garmin";

import { createDefaultGarminRuntime } from "./runtime";

type GarminRecoveryRuntime = {
  recoverActivityHistory(input: {
    trackerKey: "knee-rehab";
    profile: "daily_cron";
  }): Promise<unknown>;
  recoverWellnessHistory?(input: {
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
      const runtime = createRuntime();
      const recovery = garminActivityRecoveryResponseSchema.parse(
        await runtime.recoverActivityHistory({
          trackerKey: "knee-rehab",
          profile: "daily_cron",
        }),
      );
      const wellnessRecovery = runtime.recoverWellnessHistory
        ? garminWellnessRecoveryResponseSchema.parse(
            await runtime.recoverWellnessHistory({
              trackerKey: "knee-rehab",
              profile: "daily_cron",
            }),
          )
        : null;
      const summarize = (value: typeof recovery | typeof wellnessRecovery) =>
        !value
          ? undefined
          : value.status === "skipped"
            ? { status: "skipped" as const, reason: value.reason }
            : {
                status: "completed" as const,
                sync: {
                  batch: value.sync.batch,
                  targetDate: value.sync.targetDate,
                  summary: value.sync.summary,
                  nextCursor: value.sync.nextCursor,
                  complete: value.sync.complete,
                  lastSucceededDate: value.sync.lastSucceededDate,
                  errorCode:
                    value.sync.days.find((day) => day.status === "failed")
                      ?.errorCode ?? null,
                },
              };
      const result =
        recovery.status === "skipped"
          ? {
              status: "skipped" as const,
              reason: recovery.reason,
              wellness: summarize(wellnessRecovery),
            }
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
              wellness: summarize(wellnessRecovery),
            };
      if (result.status === "completed" && result.sync.errorCode !== null) {
        result.sync.errorCode = garminProviderErrorCodeSchema.parse(
          result.sync.errorCode,
        );
      }
      if (
        result.wellness?.status === "completed" &&
        result.wellness.sync.errorCode !== null
      ) {
        result.wellness.sync.errorCode = garminProviderErrorCodeSchema.parse(
          result.wellness.sync.errorCode,
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
