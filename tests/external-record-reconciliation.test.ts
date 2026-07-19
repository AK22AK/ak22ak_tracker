import { describe, expect, it } from "vitest";

import {
  reconcileExternalRecords,
  type ExistingExternalRecord,
  type NormalizedExternalRecord,
} from "@/server/integrations/core/external-records";

const incoming: NormalizedExternalRecord = {
  provider: "xunji",
  providerRecordId: "anonymous-train-1",
  kind: "strength_training",
  localDate: "2026-07-19",
  occurredAt: new Date("2026-07-19T04:00:00.000Z"),
  fetchedAt: new Date("2026-07-19T08:00:00.000Z"),
  contentHash: "hash-v1",
  payload: { title: "Anonymous strength session" },
};

describe("provider-neutral external record reconciliation", () => {
  it("creates a missing record and treats an identical retry as unchanged", () => {
    expect(reconcileExternalRecords([], [incoming])).toEqual({
      created: [expect.objectContaining({ sourceVersion: 1 })],
      changed: [],
      unchanged: [],
    });

    const existing: ExistingExternalRecord = {
      id: "019c0000-0000-7000-8000-000000000001",
      providerRecordId: incoming.providerRecordId,
      contentHash: incoming.contentHash,
      sourceVersion: 1,
    };
    expect(reconcileExternalRecords([existing], [incoming])).toEqual({
      created: [],
      changed: [],
      unchanged: [{ existing, incoming }],
    });
  });

  it("increments source version and requests link review when source changes", () => {
    const existing: ExistingExternalRecord = {
      id: "019c0000-0000-7000-8000-000000000001",
      providerRecordId: incoming.providerRecordId,
      contentHash: "hash-before-change",
      sourceVersion: 3,
    };

    expect(reconcileExternalRecords([existing], [incoming])).toEqual({
      created: [],
      changed: [
        {
          existing,
          incoming,
          nextSourceVersion: 4,
          markLinksForReview: true,
        },
      ],
      unchanged: [],
    });
  });
});
