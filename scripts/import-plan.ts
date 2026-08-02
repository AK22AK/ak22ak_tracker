import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { parsePlanImportArguments } from "../src/domain/plan-import";
import { planVersionSchema } from "../src/domain/schemas";
import * as schema from "../src/server/db/schema";
import { importPlanVersion } from "../src/server/plans/import-plan";

async function main() {
  const { planPath, trackerStartedOn } = parsePlanImportArguments(
    process.argv.slice(2),
  );
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const document = planVersionSchema.parse(
    JSON.parse(await readFile(resolve(planPath), "utf8")),
  );
  const database = drizzle(neon(databaseUrl), { schema });
  const trackerName = process.env.TRACKER_NAME ?? document.trackerKey;
  const trackerModule = process.env.TRACKER_MODULE ?? document.trackerKey;
  const planningTimeZone =
    process.env.TRACKER_PLANNING_TIME_ZONE ?? "Asia/Shanghai";

  const result = await importPlanVersion({
    database,
    document,
    trackerName,
    trackerModule,
    planningTimeZone,
    trackerStartedOn,
  });

  console.log(
    `Imported tracker=${result.trackerKey} plan=v${result.planVersion} tasks=${result.taskCount}${result.trackerStartUpdated ? " tracker-start-updated" : ""}`,
  );
}

void main();
