import "server-only";

import {
  todaySyncResultSchema,
  type TodaySyncResult,
  type TodaySyncSource,
} from "@/domain/today-sync";

type SyncDay =
  | { status: "succeeded"; recordCount: number }
  | { status: "failed"; errorCode: string };

type CatchUpResult = {
  days: SyncDay[];
  complete: boolean;
};

type RecoveryResult =
  | { status: "skipped"; reason: string; sync?: never }
  | {
      status: "completed";
      sync?: CatchUpResult;
      result?: CatchUpResult;
    };

type GarminRuntime = {
  recoverActivityHistory(input: {
    trackerKey: string;
    profile: "foreground";
  }): Promise<RecoveryResult>;
  recoverWellnessHistory(input: {
    trackerKey: string;
    profile: "foreground";
  }): Promise<RecoveryResult>;
};

type XunjiRuntime = {
  recoverHistory(input: {
    trackerKey: string;
    batchSize?: number;
    profile: "foreground";
  }): Promise<RecoveryResult>;
};

const credentialErrorCodes = new Set([
  "authentication",
  "credential_not_found",
  "invalid",
  "invalid_token_bundle",
  "membership_required",
  "needs_refresh",
  "needs_validation",
  "unsupported_client_version",
]);

function errorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "provider_unavailable";
}

function failedSource(
  source: TodaySyncSource["source"],
  error: unknown,
): TodaySyncSource {
  return {
    source,
    status: credentialErrorCodes.has(errorCode(error))
      ? "needs_credentials"
      : "temporarily_failed",
    recordCount: 0,
    continueAvailable: false,
  };
}

function projectRecovery(
  source: TodaySyncSource["source"],
  result: RecoveryResult,
): TodaySyncSource {
  if (result.status === "skipped") {
    if (result.reason === "not_connected") {
      return {
        source,
        status: "not_connected",
        recordCount: 0,
        continueAvailable: false,
      };
    }
    if (result.reason === "in_progress") {
      return {
        source,
        status: "syncing",
        recordCount: 0,
        continueAvailable: true,
      };
    }
    return failedSource(source, { code: result.reason });
  }

  const sync = result.sync ?? result.result;
  if (!sync) return failedSource(source, { code: "provider_unavailable" });
  const failedDay = sync.days.find(
    (day): day is Extract<SyncDay, { status: "failed" }> =>
      day.status === "failed",
  );
  const recordCount = sync.days.reduce(
    (total, day) =>
      day.status === "succeeded" ? total + day.recordCount : total,
    0,
  );
  if (failedDay) return failedSource(source, { code: failedDay.errorCode });
  return {
    source,
    status: recordCount > 0 ? "records" : "no_records",
    recordCount,
    continueAvailable: !sync.complete,
  };
}

async function safelyRun(
  source: TodaySyncSource["source"],
  run: () => Promise<RecoveryResult>,
) {
  try {
    return projectRecovery(source, await run());
  } catch (error) {
    return failedSource(source, error);
  }
}

export async function coordinateLatestSync(input: {
  trackerKey: string;
  garminRuntime: GarminRuntime;
  xunjiRuntime: XunjiRuntime;
}): Promise<TodaySyncResult> {
  const sources = [
    await safelyRun("garmin_activity", () =>
      input.garminRuntime.recoverActivityHistory({
        trackerKey: input.trackerKey,
        profile: "foreground",
      }),
    ),
    await safelyRun("garmin_wellness", () =>
      input.garminRuntime.recoverWellnessHistory({
        trackerKey: input.trackerKey,
        profile: "foreground",
      }),
    ),
    await safelyRun("xunji_training", () =>
      input.xunjiRuntime.recoverHistory({
        trackerKey: input.trackerKey,
        profile: "foreground",
      }),
    ),
  ];
  return todaySyncResultSchema.parse({ sources });
}
