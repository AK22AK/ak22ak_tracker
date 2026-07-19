import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { executionAlternativeBundleSchema } from "../src/domain/execution-context";
import {
  executionAlternativeVersions,
  trackers,
} from "../src/server/db/schema";

async function main() {
  const bundlePath = process.argv
    .slice(2)
    .find((argument) => argument !== "--");
  const databaseUrl = process.env.DATABASE_URL;
  if (!bundlePath) {
    throw new Error(
      "Usage: pnpm execution-alternatives:import -- <private-bundle.json>",
    );
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const bundle = executionAlternativeBundleSchema.parse(
    JSON.parse(await readFile(resolve(bundlePath), "utf8")),
  );
  const database = drizzle(neon(databaseUrl));
  const [tracker] = await database
    .select({ id: trackers.id })
    .from(trackers)
    .where(and(eq(trackers.key, bundle.trackerKey), eq(trackers.active, true)))
    .limit(1);
  if (!tracker) throw new Error("Tracker not found");

  for (const option of bundle.options) {
    const [existing] = await database
      .select({
        id: executionAlternativeVersions.id,
        document: executionAlternativeVersions.document,
      })
      .from(executionAlternativeVersions)
      .where(
        and(
          eq(executionAlternativeVersions.trackerId, tracker.id),
          eq(executionAlternativeVersions.optionKey, option.optionKey),
          eq(executionAlternativeVersions.version, option.version),
        ),
      )
      .limit(1);
    if (
      existing &&
      (existing.id !== option.id ||
        !isDeepStrictEqual(existing.document, option))
    ) {
      throw new Error(
        `Alternative version already exists with different content: ${option.optionKey}@${option.version}`,
      );
    }
  }

  const statements = bundle.options.map((option) =>
    database
      .insert(executionAlternativeVersions)
      .values({
        id: option.id,
        trackerId: tracker.id,
        optionKey: option.optionKey,
        version: option.version,
        effectiveFrom: option.effectiveFrom,
        document: option,
        createdAt: new Date(option.createdAt),
      })
      .onConflictDoNothing({
        target: [
          executionAlternativeVersions.trackerId,
          executionAlternativeVersions.optionKey,
          executionAlternativeVersions.version,
        ],
      }),
  );
  const [firstStatement, ...remainingStatements] = statements;
  if (!firstStatement) throw new Error("At least one alternative is required");
  await database.batch([firstStatement, ...remainingStatements]);

  console.log(
    `Imported execution alternatives tracker=${bundle.trackerKey} versions=${bundle.options.length}`,
  );
}

void main();
