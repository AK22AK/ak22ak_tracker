import { describe, expect, it } from "vitest";

import { schemaVersion, trackerEventSchema } from "@/domain/schemas";
import { eventMirrorPath } from "@/server/mirror/path";

describe("eventMirrorPath", () => {
  it("creates a deterministic monthly path", () => {
    const event = trackerEventSchema.parse({
      schemaVersion,
      id: "019bfe22-f969-7000-8000-000000000001",
      trackerKey: "knee-rehab",
      kind: "symptom_check_in",
      occurredAt: "2026-07-16T08:15:00+08:00",
      recordedAt: "2026-07-16T08:16:00+08:00",
      localDate: "2026-07-16",
      idempotencyKey: "phone-019bfe22-f969-7000-8000-000000000001",
      payload: { pain: 2 },
      provenance: { source: "user" },
    });

    expect(eventMirrorPath(event)).toBe(
      "trackers/knee-rehab/events/2026/07/019bfe22-f969-7000-8000-000000000001.json",
    );
  });
});
