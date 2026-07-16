import { sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDatabase().execute(sql`select 1`);

    return Response.json(
      {
        status: "ok",
        service: "ak22ak_tracker",
        database: "ok",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      {
        status: "degraded",
        service: "ak22ak_tracker",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
