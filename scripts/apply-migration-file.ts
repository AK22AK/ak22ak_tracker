import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

async function main() {
  const migrationPath = process.argv
    .slice(2)
    .find((argument) => argument !== "--");
  const databaseUrl = process.env.DATABASE_URL;
  if (!migrationPath || !databaseUrl) {
    throw new Error(
      "Usage: DATABASE_URL=... tsx scripts/apply-migration-file.ts <migration.sql>",
    );
  }

  const statements = (await readFile(resolve(migrationPath), "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const client = neon(databaseUrl);
  for (const statement of statements) {
    await client.query(statement, []);
  }
  console.log(`Applied ${statements.length} migration statements`);
}

void main();
