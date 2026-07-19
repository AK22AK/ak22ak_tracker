import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import {
  canonicalSafetyPolicyJson,
  trackerSafetyPolicyDocumentSchema,
} from "../src/domain/safety-policy";
import { trackerSafetyPolicies, trackers } from "../src/server/db/schema";

async function main() {
  const policyPath = process.argv
    .slice(2)
    .find((argument) => argument !== "--");
  const databaseUrl = process.env.DATABASE_URL;

  if (!policyPath) {
    throw new Error("Usage: pnpm safety-policy:import -- <policy.json>");
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const document = trackerSafetyPolicyDocumentSchema.parse(
    JSON.parse(await readFile(resolve(policyPath), "utf8")),
  );
  const hash = createHash("sha256")
    .update(canonicalSafetyPolicyJson(document))
    .digest("hex");
  const database = drizzle(neon(databaseUrl));
  const [tracker] = await database
    .select({ id: trackers.id })
    .from(trackers)
    .where(
      and(eq(trackers.key, document.trackerKey), eq(trackers.active, true)),
    )
    .limit(1);

  if (!tracker) throw new Error("Tracker not found");

  const [existing] = await database
    .select({
      id: trackerSafetyPolicies.id,
      hash: trackerSafetyPolicies.hash,
    })
    .from(trackerSafetyPolicies)
    .where(
      and(
        eq(trackerSafetyPolicies.trackerId, tracker.id),
        eq(trackerSafetyPolicies.version, document.version),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.id !== document.policyId || existing.hash !== hash) {
      throw new Error("Policy version already exists with different content");
    }
    console.log(
      `Policy already imported tracker=${document.trackerKey} version=${document.version} id=${document.policyId} hash=${hash}`,
    );
    return;
  }

  await database.insert(trackerSafetyPolicies).values({
    id: document.policyId,
    trackerId: tracker.id,
    version: document.version,
    effectiveFrom: new Date(document.effectiveFrom),
    hash,
    document,
    createdAt: new Date(document.createdAt),
  });

  console.log(
    `Imported safety policy tracker=${document.trackerKey} version=${document.version} id=${document.policyId} hash=${hash}`,
  );
}

void main();
