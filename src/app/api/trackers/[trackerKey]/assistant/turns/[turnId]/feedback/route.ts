import { isDeepStrictEqual } from "node:util";

import { ZodError } from "zod";

import { saveAssistantFeedbackCommandSchema } from "@/domain/rehab-assistant";
import { localDateInTimeZone } from "@/domain/planning-time";
import { safetyPolicyReference } from "@/domain/safety-policy";
import {
  auditedKneeCheckInEventPayloadSchema,
  evaluateKneeCheckIn,
  kneeCheckInInputSchema,
} from "@/modules/knee-rehab/check-in";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonEventCommandStore } from "@/server/commands/event-command";
import {
  executeAppendEventCommand,
  EventCommandConflictError,
} from "@/server/commands/event-command-core";
import { getAssistantStore } from "@/server/integrations/assistant/repository";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";
import { getEffectiveTrackerSafetyPolicy } from "@/server/safety-policy/repository";

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ trackerKey: string; turnId: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const assistantStore = getAssistantStore();
    const { trackerKey, turnId } = await params;
    const input = saveAssistantFeedbackCommandSchema.parse(
      await request.json(),
    );
    if (input.turnId !== turnId) {
      return Response.json({ error: "turn_mismatch" }, { status: 400 });
    }
    const tracker = await assistantStore.requireTracker(trackerKey);
    const turn = await assistantStore.findTurn(tracker.id, turnId);
    if (!turn || turn.status !== "succeeded" || !turn.response?.feedbackDraft) {
      return Response.json(
        { error: "feedback_not_available" },
        { status: 409 },
      );
    }
    if (
      input.feedback.localDate >
      localDateInTimeZone(new Date(), tracker.planningTimeZone)
    ) {
      return Response.json(
        { error: "future_date_not_allowed" },
        { status: 400 },
      );
    }
    const occurredAt = new Date(input.occurredAt);
    if (
      localDateInTimeZone(occurredAt, input.occurredTimeZone) !==
      input.feedback.localDate
    ) {
      return Response.json({ error: "date_mismatch" }, { status: 400 });
    }
    const checkIn = kneeCheckInInputSchema.parse(input.feedback);
    const policy = await getEffectiveTrackerSafetyPolicy(
      trackerKey,
      occurredAt,
    );
    const policyReference = safetyPolicyReference(policy);
    const safetyLevel = evaluateKneeCheckIn(checkIn, policy.rules);
    const result = await executeAppendEventCommand(
      createNeonEventCommandStore(),
      {
        commandId: input.commandId,
        trackerKey,
        kind: "symptom_check_in",
        payload: { ...checkIn, safetyLevel, safetyPolicy: policyReference },
        occurredAt: input.occurredAt,
        occurredTimeZone: input.occurredTimeZone,
        occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
        payloadMatches: (existingPayload) => {
          const parsed = kneeCheckInInputSchema.safeParse(existingPayload);
          return parsed.success && isDeepStrictEqual(parsed.data, checkIn);
        },
      },
    );
    const canonical = auditedKneeCheckInEventPayloadSchema.parse(
      result.event.payload,
    );
    await assistantStore.markFeedbackConfirmed({
      trackerId: tracker.id,
      turnId,
      feedbackId: result.event.id,
      updatedAt: new Date(),
    });
    scheduleGitHubMirrorAfterResponse();
    return Response.json({
      id: result.event.id,
      safetyLevel: canonical.safetyLevel,
      replayed: result.replayed,
      conversation: await assistantStore.loadConversation(trackerKey),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof EventCommandConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "feedback_unavailable" }, { status: 503 });
  }
}
