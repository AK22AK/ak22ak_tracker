import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { planVersionSchema } from "../src/domain/schemas";
import { planVersions, taskInstances, trackers } from "../src/server/db/schema";

async function main() {
  const planPath = process.argv.slice(2).find((argument) => argument !== "--");
  const databaseUrl = process.env.DATABASE_URL;

  if (!planPath) {
    throw new Error("Usage: pnpm plan:import -- <plan-version.json>");
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const document = planVersionSchema.parse(
    JSON.parse(await readFile(resolve(planPath), "utf8")),
  );
  const database = drizzle(neon(databaseUrl));
  const trackerName = process.env.TRACKER_NAME ?? document.trackerKey;
  const trackerModule = process.env.TRACKER_MODULE ?? document.trackerKey;

  const [tracker] = await database
    .insert(trackers)
    .values({
      key: document.trackerKey,
      name: trackerName,
      module: trackerModule,
      startedOn: document.effectiveFrom,
    })
    .onConflictDoUpdate({
      target: trackers.key,
      set: {
        name: trackerName,
        module: trackerModule,
        startedOn: document.effectiveFrom,
        active: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: trackers.id });

  if (!tracker) {
    throw new Error("Tracker upsert did not return an id");
  }

  await database
    .insert(planVersions)
    .values({
      id: document.id,
      trackerId: tracker.id,
      version: document.version,
      effectiveFrom: document.effectiveFrom,
      document,
    })
    .onConflictDoNothing({ target: planVersions.id });

  await database
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

  console.log(
    `Imported tracker=${document.trackerKey} plan=v${document.version} tasks=${document.tasks.length}`,
  );
}

void main();
