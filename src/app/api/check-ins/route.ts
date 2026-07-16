import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { schemaVersion, trackerEventSchema } from "@/domain/schemas";
import {
  evaluateKneeCheckIn,
  kneeCheckInInputSchema,
} from "@/modules/knee-rehab/check-in";
import { authOptions } from "@/server/auth/options";
import { getDatabase } from "@/server/db/client";
import { events, trackers } from "@/server/db/schema";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const input = kneeCheckInInputSchema.parse(await request.json());
  const database = getDatabase();
  const [tracker] = await database
    .select()
    .from(trackers)
    .where(and(eq(trackers.key, "knee-rehab"), eq(trackers.active, true)))
    .limit(1);

  if (!tracker) {
    return Response.json({ error: "tracker_not_found" }, { status: 404 });
  }

  const now = new Date();
  const eventId = randomUUID();
  const safetyLevel = evaluateKneeCheckIn(input);
  const event = trackerEventSchema.parse({
    schemaVersion,
    id: eventId,
    trackerKey: tracker.key,
    kind: "symptom_check_in",
    occurredAt: now.toISOString(),
    recordedAt: now.toISOString(),
    localDate: input.localDate,
    idempotencyKey: `check-in:${eventId}`,
    payload: { ...input, safetyLevel },
    provenance: { source: "user" },
  });

  await database.insert(events).values({
    id: event.id,
    trackerId: tracker.id,
    kind: event.kind,
    localDate: event.localDate,
    occurredAt: new Date(event.occurredAt),
    recordedAt: new Date(event.recordedAt),
    idempotencyKey: event.idempotencyKey,
    document: event,
  });

  return Response.json({ id: event.id, safetyLevel });
}
