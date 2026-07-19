import "server-only";

import { randomUUID } from "node:crypto";

import type { ExternalRecord } from "@/domain/schemas";

export type IntegrationProvider = ExternalRecord["provider"];

export type NormalizedExternalRecord = {
  provider: IntegrationProvider;
  providerRecordId: string;
  kind: ExternalRecord["kind"];
  localDate: string;
  occurredAt: Date;
  fetchedAt: Date;
  contentHash: string;
  payload: Record<string, unknown>;
};

export type ExistingExternalRecord = {
  id: string;
  providerRecordId: string;
  contentHash: string;
  sourceVersion: number;
};

export function reconcileExternalRecords(
  existingRecords: ExistingExternalRecord[],
  incomingRecords: NormalizedExternalRecord[],
) {
  const existingByProviderId = new Map(
    existingRecords.map((record) => [record.providerRecordId, record]),
  );
  const created: Array<
    NormalizedExternalRecord & { id: string; sourceVersion: 1 }
  > = [];
  const changed: Array<{
    existing: ExistingExternalRecord;
    incoming: NormalizedExternalRecord;
    nextSourceVersion: number;
    markLinksForReview: true;
  }> = [];
  const unchanged: Array<{
    existing: ExistingExternalRecord;
    incoming: NormalizedExternalRecord;
  }> = [];

  for (const incoming of incomingRecords) {
    const existing = existingByProviderId.get(incoming.providerRecordId);
    if (!existing) {
      created.push({ ...incoming, id: randomUUID(), sourceVersion: 1 });
    } else if (existing.contentHash === incoming.contentHash) {
      unchanged.push({ existing, incoming });
    } else {
      changed.push({
        existing,
        incoming,
        nextSourceVersion: existing.sourceVersion + 1,
        markLinksForReview: true,
      });
    }
  }

  return { created, changed, unchanged };
}
