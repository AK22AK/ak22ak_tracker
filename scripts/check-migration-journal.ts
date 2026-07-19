import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const expected = readMigrationFiles({
    migrationsFolder: resolve("drizzle"),
  }).at(-1);
  if (!expected) {
    throw new Error("No local migrations found");
  }

  const client = neon(databaseUrl);
  const rows = await client.query(
    "select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1",
    [],
  );
  const latest = rows[0] as { hash: string; created_at: string } | undefined;

  if (
    !latest ||
    latest.hash !== expected.hash ||
    latest.created_at !== String(expected.folderMillis)
  ) {
    throw new Error(
      "Migration journal does not match the latest local migration",
    );
  }

  console.log(
    `Migration journal verified: created_at=${latest.created_at} hash=${latest.hash}`,
  );
}

void main();
