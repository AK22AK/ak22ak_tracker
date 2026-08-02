import { isDeepStrictEqual } from "node:util";

import { and, eq } from "drizzle-orm";

import { planVersionSchema, type PlanVersion } from "@/domain/schemas";
import type { getDatabase } from "@/server/db/client";
import { planVersions, taskInstances, trackers } from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

export interface ImportPlanVersionInput {
  database: Database;
  document: PlanVersion;
  trackerName: string;
  trackerModule: string;
  planningTimeZone: string;
  trackerStartedOn?: string;
}

export async function importPlanVersion(input: ImportPlanVersionInput) {
  const document = planVersionSchema.parse(input.document);
  const [tracker] = await input.database
    .insert(trackers)
    .values({
      key: document.trackerKey,
      name: input.trackerName,
      module: input.trackerModule,
      startedOn: input.trackerStartedOn ?? document.effectiveFrom,
      planningTimeZone: input.planningTimeZone,
    })
    .onConflictDoUpdate({
      target: trackers.key,
      set: {
        name: input.trackerName,
        module: input.trackerModule,
        planningTimeZone: input.planningTimeZone,
        active: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: trackers.id });

  if (!tracker) {
    throw new Error("Tracker upsert did not return an id");
  }

  const [existingById] = await input.database
    .select({
      id: planVersions.id,
      trackerId: planVersions.trackerId,
      version: planVersions.version,
      document: planVersions.document,
    })
    .from(planVersions)
    .where(eq(planVersions.id, document.id))
    .limit(1);
  const [existingByVersion] = await input.database
    .select({
      id: planVersions.id,
      trackerId: planVersions.trackerId,
      version: planVersions.version,
      document: planVersions.document,
    })
    .from(planVersions)
    .where(
      and(
        eq(planVersions.trackerId, tracker.id),
        eq(planVersions.version, document.version),
      ),
    )
    .limit(1);

  for (const existing of [existingById, existingByVersion]) {
    if (
      existing &&
      (existing.id !== document.id ||
        existing.trackerId !== tracker.id ||
        existing.version !== document.version ||
        !isDeepStrictEqual(existing.document, document))
    ) {
      throw new Error(
        `Plan version already exists with different content: v${document.version}`,
      );
    }
  }

  const planInsert = input.database
    .insert(planVersions)
    .values({
      id: document.id,
      trackerId: tracker.id,
      version: document.version,
      effectiveFrom: document.effectiveFrom,
      document,
      createdAt: new Date(document.createdAt),
    })
    .onConflictDoNothing({
      target: [planVersions.trackerId, planVersions.version],
    });
  const taskInsert = input.database
    .insert(taskInstances)
    .values(
      document.tasks.map((task) => ({
        trackerId: tracker.id,
        planVersionId: document.id,
        taskDefinitionId: task.id,
        scheduledOn: task.scheduledDate,
      })),
    )
    .onConflictDoNothing({
      target: [taskInstances.planVersionId, taskInstances.taskDefinitionId],
    });

  if (input.trackerStartedOn) {
    const trackerUpdate = input.database
      .update(trackers)
      .set({
        startedOn: input.trackerStartedOn,
        updatedAt: new Date(),
      })
      .where(eq(trackers.id, tracker.id));
    await input.database.batch([trackerUpdate, planInsert, taskInsert]);
  } else {
    await input.database.batch([planInsert, taskInsert]);
  }

  return {
    trackerId: tracker.id,
    trackerKey: document.trackerKey,
    planVersion: document.version,
    taskCount: document.tasks.length,
    trackerStartUpdated: Boolean(input.trackerStartedOn),
  };
}
