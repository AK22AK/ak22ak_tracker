import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { schemaVersion, trackerEventSchema } from "@/domain/schemas";
import { authOptions } from "@/server/auth/options";
import { getDatabase } from "@/server/db/client";
import { events, taskInstances, trackers } from "@/server/db/schema";

const updateTaskSchema = z.object({
  status: z.enum(["planned", "completed", "skipped"]),
  note: z.string().max(2_000).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const input = updateTaskSchema.parse(await request.json());
  const { taskId } = await context.params;
  const database = getDatabase();
  const [task] = await database
    .select({
      id: taskInstances.id,
      trackerId: taskInstances.trackerId,
      scheduledOn: taskInstances.scheduledOn,
      trackerKey: trackers.key,
    })
    .from(taskInstances)
    .innerJoin(trackers, eq(taskInstances.trackerId, trackers.id))
    .where(and(eq(taskInstances.id, taskId), eq(trackers.active, true)))
    .limit(1);

  if (!task) {
    return Response.json({ error: "task_not_found" }, { status: 404 });
  }

  const now = new Date();
  const [updated] = await database
    .update(taskInstances)
    .set({
      status: input.status,
      completedAt: input.status === "completed" ? now : null,
      confirmedByUser: input.status !== "planned",
      subjectiveNote: input.note,
    })
    .where(eq(taskInstances.id, task.id))
    .returning({ status: taskInstances.status });

  const eventId = randomUUID();
  const event = trackerEventSchema.parse({
    schemaVersion,
    id: eventId,
    trackerKey: task.trackerKey,
    kind: "task_completion",
    occurredAt: now.toISOString(),
    recordedAt: now.toISOString(),
    localDate: task.scheduledOn,
    idempotencyKey: `task-update:${task.id}:${eventId}`,
    payload: {
      taskInstanceId: task.id,
      status: input.status,
      note: input.note ?? null,
    },
    provenance: { source: "user" },
  });

  await database.insert(events).values({
    id: event.id,
    trackerId: task.trackerId,
    kind: event.kind,
    localDate: event.localDate,
    occurredAt: new Date(event.occurredAt),
    recordedAt: new Date(event.recordedAt),
    idempotencyKey: event.idempotencyKey,
    document: event,
  });

  return Response.json({ status: updated?.status ?? input.status });
}
