import { isDeepStrictEqual } from "node:util";

import { ZodError } from "zod";

import { clientCommandMetadataSchema } from "@/domain/schemas";
import {
  safetyPolicyReference,
  safetyPolicyReferenceSchema,
} from "@/domain/safety-policy";
import {
  auditedKneeCheckInEventPayloadSchema,
  evaluateKneeCheckIn,
  kneeCheckInInputSchema,
} from "@/modules/knee-rehab/check-in";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonEventCommandStore } from "@/server/commands/event-command";
import {
  EventCommandConflictError,
  executeAppendEventCommand,
  TrackerNotFoundError,
} from "@/server/commands/event-command-core";
import {
  getEffectiveTrackerSafetyPolicy,
  TrackerSafetyPolicyNotFoundError,
} from "@/server/safety-policy/repository";

const checkInCommandSchema = clientCommandMetadataSchema.and(
  kneeCheckInInputSchema.extend({
    clientSafetyPolicy: safetyPolicyReferenceSchema.optional(),
  }),
);

export async function POST(request: Request) {
  const session = await getAuthorizedSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const input = checkInCommandSchema.parse(await request.json());
    const checkIn = kneeCheckInInputSchema.parse(input);
    const policy = await getEffectiveTrackerSafetyPolicy(
      "knee-rehab",
      new Date(input.occurredAt),
    );
    const policyReference = safetyPolicyReference(policy);
    const safetyLevel = evaluateKneeCheckIn(checkIn, policy.rules);
    const result = await executeAppendEventCommand(
      createNeonEventCommandStore(),
      {
        commandId: input.commandId,
        trackerKey: "knee-rehab",
        kind: "symptom_check_in",
        payload: {
          ...checkIn,
          safetyLevel,
          safetyPolicy: policyReference,
        },
        occurredAt: input.occurredAt,
        occurredTimeZone: input.occurredTimeZone,
        occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
        payloadMatches: (existingPayload) => {
          const parsed = kneeCheckInInputSchema.safeParse(existingPayload);
          return parsed.success && isDeepStrictEqual(parsed.data, checkIn);
        },
      },
    );
    const canonicalPayload = auditedKneeCheckInEventPayloadSchema.parse(
      result.event.payload,
    );

    return Response.json({
      id: result.event.id,
      safetyLevel: canonicalPayload.safetyLevel,
      replayed: result.replayed,
      safetyPolicy: canonicalPayload.safetyPolicy,
      clientPolicyOutdated:
        input.clientSafetyPolicy !== undefined &&
        input.clientSafetyPolicy.hash !== canonicalPayload.safetyPolicy.hash,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof TrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof TrackerSafetyPolicyNotFoundError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof EventCommandConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
