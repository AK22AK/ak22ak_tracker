import "server-only";

import { z } from "zod";

import { localDateSchema } from "@/domain/schemas";

export type GarminClientDescriptor = {
  id: string;
  version: string;
  kind: "official_api" | "private_client" | "fit_import";
};

export const garminPrivateClientDescriptor = {
  id: "python-garminconnect",
  version: "0.3.6",
  kind: "private_client",
  package: "garminconnect",
  source: "https://github.com/cyberjunky/python-garminconnect",
} as const satisfies GarminClientDescriptor & {
  package: string;
  source: string;
};

const nativeTokenBundleSchema = z
  .object({
    di_token: z.string().min(1).max(32_768),
    di_refresh_token: z.string().min(1).max(32_768),
    di_client_id: z.string().min(1).max(2_048),
  })
  .strict();

export const garminCredentialSchema = z
  .object({
    schemaVersion: z.literal(1),
    client: z.literal(garminPrivateClientDescriptor.id),
    clientVersion: z.literal(garminPrivateClientDescriptor.version),
    region: z.enum(["global", "china"]),
    tokenBundle: z.string().min(2).max(131_072),
  })
  .strict()
  .superRefine((credential, context) => {
    try {
      nativeTokenBundleSchema.parse(JSON.parse(credential.tokenBundle));
    } catch {
      context.addIssue({
        code: "custom",
        path: ["tokenBundle"],
        message: "Invalid Garmin token bundle",
      });
    }
  });

export type GarminCredential = z.infer<typeof garminCredentialSchema>;

export const garminActivityEvidenceSchema = z
  .object({
    providerRecordId: z.string().min(1).max(200),
    activityType: z.string().min(1).max(100),
    startedAt: z.string().datetime({ offset: true }),
    durationSeconds: z.number().nonnegative().max(604_800),
    distanceMeters: z.number().nonnegative().max(10_000_000).nullable(),
    averagePaceSecondsPerKilometer: z
      .number()
      .positive()
      .max(86_400)
      .nullable(),
    averageHeartRateBpm: z.number().int().positive().max(300).nullable(),
  })
  .strict();

export type GarminActivityEvidence = z.infer<
  typeof garminActivityEvidenceSchema
>;

export const garminDailyEvidenceSchema = z
  .object({
    localDate: localDateSchema,
    steps: z.number().int().nonnegative().max(1_000_000).nullable(),
    walkingDistanceMeters: z.number().nonnegative().max(10_000_000).nullable(),
  })
  .strict();

export type GarminDailyEvidence = z.infer<typeof garminDailyEvidenceSchema>;

export const garminSleepEvidenceSchema = z
  .object({
    localDate: localDateSchema,
    sleepStartedAt: z.string().datetime({ offset: true }).nullable(),
    sleepEndedAt: z.string().datetime({ offset: true }).nullable(),
    durationSeconds: z.number().nonnegative().max(172_800).nullable(),
    score: z.number().nonnegative().max(100).nullable(),
  })
  .strict();

export type GarminSleepEvidence = z.infer<typeof garminSleepEvidenceSchema>;

export const kneeRehabGarminScope = {
  activityTypes: [
    "running",
    "walking",
    "hiking",
    "cycling",
    "swimming",
    "strength_training",
  ],
  activityFields: [
    "startedAt",
    "durationSeconds",
    "distanceMeters",
    "pace",
    "heartRate",
  ],
  laterDailyFields: ["steps", "walkingDistanceMeters"],
  laterSleepFields: [
    "sleepStartedAt",
    "sleepEndedAt",
    "durationSeconds",
    "score",
  ],
} as const;

export interface GarminClient<TCredential = unknown> {
  readonly descriptor: GarminClientDescriptor;

  validateCredential(input: {
    credential: TCredential;
    signal?: AbortSignal;
  }): Promise<{ refreshedCredential: GarminCredential | null }>;

  fetchActivitiesForDate(input: {
    credential: TCredential;
    date: string;
    signal?: AbortSignal;
  }): Promise<GarminActivityEvidence[]>;

  fetchDailyEvidenceForDate?(input: {
    credential: TCredential;
    date: string;
    signal?: AbortSignal;
  }): Promise<GarminDailyEvidence>;

  fetchSleepEvidenceForDate?(input: {
    credential: TCredential;
    date: string;
    signal?: AbortSignal;
  }): Promise<GarminSleepEvidence>;
}
