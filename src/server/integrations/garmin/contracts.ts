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

export const garminActivityReadResultSchema = z
  .object({
    activities: z.array(garminActivityEvidenceSchema).max(100),
    refreshedCredential: garminCredentialSchema,
  })
  .strict();

export type GarminActivityReadResult = z.infer<
  typeof garminActivityReadResultSchema
>;

export const garminStepsEvidenceSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      totalSteps: z.number().int().nonnegative().max(1_000_000),
      stepGoal: z.number().int().nonnegative().max(1_000_000).nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("missing"),
      totalSteps: z.null(),
      stepGoal: z.null(),
    })
    .strict(),
]);

export const garminSleepEvidenceSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      sleepStart: z.string().datetime({ offset: true }).nullable(),
      sleepEnd: z.string().datetime({ offset: true }).nullable(),
      totalSleepSeconds: z.number().int().nonnegative().max(172_800),
      deepSleepSeconds: z.number().int().nonnegative().max(172_800).nullable(),
      lightSleepSeconds: z.number().int().nonnegative().max(172_800).nullable(),
      remSleepSeconds: z.number().int().nonnegative().max(172_800).nullable(),
      awakeSleepSeconds: z.number().int().nonnegative().max(172_800).nullable(),
      sleepScore: z.number().int().nonnegative().max(100).nullable(),
    })
    .strict()
    .superRefine((sleep, context) => {
      if ((sleep.sleepStart === null) !== (sleep.sleepEnd === null)) {
        context.addIssue({
          code: "custom",
          message: "Incomplete sleep window",
        });
      }
      if (
        sleep.sleepStart !== null &&
        sleep.sleepEnd !== null &&
        sleep.sleepEnd < sleep.sleepStart
      ) {
        context.addIssue({ code: "custom", message: "Invalid sleep window" });
      }
    }),
  z
    .object({
      status: z.literal("missing"),
      sleepStart: z.null(),
      sleepEnd: z.null(),
      totalSleepSeconds: z.null(),
      deepSleepSeconds: z.null(),
      lightSleepSeconds: z.null(),
      remSleepSeconds: z.null(),
      awakeSleepSeconds: z.null(),
      sleepScore: z.null(),
    })
    .strict(),
]);

export const garminWellnessEvidenceSchema = z
  .object({
    localDate: localDateSchema,
    steps: garminStepsEvidenceSchema,
    sleep: garminSleepEvidenceSchema,
  })
  .strict();

export const garminWellnessReadResultSchema = z
  .object({
    wellness: garminWellnessEvidenceSchema,
    refreshedCredential: garminCredentialSchema,
  })
  .strict();

export type GarminWellnessEvidence = z.infer<
  typeof garminWellnessEvidenceSchema
>;
export type GarminWellnessReadResult = z.infer<
  typeof garminWellnessReadResultSchema
>;

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
  laterDailyFields: ["totalSteps", "stepGoal"],
  laterSleepFields: [
    "sleepStart",
    "sleepEnd",
    "totalSleepSeconds",
    "deepSleepSeconds",
    "lightSleepSeconds",
    "remSleepSeconds",
    "awakeSleepSeconds",
    "sleepScore",
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
  }): Promise<GarminActivityReadResult>;

  fetchWellnessForDate(input: {
    credential: TCredential;
    date: string;
    signal?: AbortSignal;
  }): Promise<GarminWellnessReadResult>;
}
