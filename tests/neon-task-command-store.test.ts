import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it, vi } from "vitest";

import { schemaVersion, trackerEventSchema } from "@/domain/schemas";
import { createNeonTaskCommandStore } from "@/server/commands/task-command";
import type { PreparedTaskCommand } from "@/server/commands/task-command-core";
import * as schema from "@/server/db/schema";

const event = trackerEventSchema.parse({
  schemaVersion,
  id: "019c0000-0000-7000-8000-000000000001",
  trackerKey: "example-tracker",
  kind: "task_completion",
  occurredAt: "2026-07-18T16:00:00.000Z",
  recordedAt: "2026-07-18T16:00:01.000Z",
  occurredTimeZone: "Asia/Shanghai",
  occurredUtcOffsetMinutes: 480,
  localDate: "2026-07-19",
  idempotencyKey: "019c0000-0000-7000-8000-000000000001",
  payload: {
    taskInstanceId: "019c0000-0000-7000-8000-000000000002",
    status: "completed",
    actual: null,
    note: null,
  },
  provenance: { source: "user" },
});

const command: PreparedTaskCommand = {
  trackerId: "019c0000-0000-7000-8000-000000000003",
  taskUpdate: {
    taskId: "019c0000-0000-7000-8000-000000000002",
    status: "completed",
    actual: null,
    note: null,
    completedAt: new Date("2026-07-18T16:00:01.000Z"),
  },
  event,
  outbox: {
    aggregateType: "event",
    aggregateId: event.id,
    targetPath:
      "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000001.json",
    payload: event,
  },
};

describe("Neon task command store (P0-02)", () => {
  it("submits projection, event, and outbox in one Neon HTTP batch", async () => {
    const database = drizzle.mock({ schema });
    const batch = vi.spyOn(database, "batch").mockResolvedValue([] as never);
    const store = createNeonTaskCommandStore(database as never);

    await store.commitAtomically(command);

    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it("does not report success when the atomic batch fails", async () => {
    const database = drizzle.mock({ schema });
    vi.spyOn(database, "batch").mockRejectedValue(new Error("batch_failed"));
    const store = createNeonTaskCommandStore(database as never);

    await expect(store.commitAtomically(command)).rejects.toThrow(
      "batch_failed",
    );
  });
});
