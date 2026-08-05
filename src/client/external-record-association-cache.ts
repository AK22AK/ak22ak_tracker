import "client-only";

import type { QueryClient } from "@tanstack/react-query";

import type { DayAggregate, TodayAggregate } from "@/domain/api-contracts";
import type { ExternalRecordAssociation } from "@/domain/external-training";
import { updateExternalRecordAssociationSnapshots } from "@/offline/query-snapshots";
import { offlineDatabase } from "@/offline/store";

import { trackerQueryKeys } from "./query-keys";

function withCanonicalAssociation<T extends { day: TodayAggregate["day"] }>(
  aggregate: T,
  recordId: string,
  association: ExternalRecordAssociation,
): T {
  return {
    ...aggregate,
    day: {
      ...aggregate.day,
      externalTrainingRecords: aggregate.day.externalTrainingRecords.map(
        (record) =>
          record.id === recordId
            ? { ...record, association, suggestion: null }
            : record,
      ),
    },
  };
}

export async function projectCanonicalExternalRecordAssociation(input: {
  queryClient: QueryClient;
  githubUserId: string | null;
  trackerKey: string;
  localDate: string;
  recordId: string;
  association: ExternalRecordAssociation;
}) {
  const {
    queryClient,
    githubUserId,
    trackerKey,
    localDate,
    recordId,
    association,
  } = input;

  queryClient.setQueryData<TodayAggregate>(
    trackerQueryKeys.today(trackerKey, localDate),
    (current) =>
      current && current.targetDate === localDate
        ? withCanonicalAssociation(current, recordId, association)
        : current,
  );
  queryClient.setQueryData<DayAggregate>(
    trackerQueryKeys.day(trackerKey, localDate),
    (current) =>
      current && current.targetDate === localDate
        ? withCanonicalAssociation(current, recordId, association)
        : current,
  );

  void queryClient.invalidateQueries({
    queryKey: trackerQueryKeys.calendar(trackerKey, localDate.slice(0, 7)),
    exact: true,
  });

  if (!githubUserId) return;
  for (const kind of ["today", "day"] as const) {
    const snapshotQueryKey = [
      "private-offline-snapshot",
      githubUserId,
      trackerKey,
      kind,
      localDate,
    ] as const;
    queryClient.setQueryData<{ data: TodayAggregate | DayAggregate }>(
      snapshotQueryKey,
      (current) =>
        current?.data && current.data.targetDate === localDate
          ? {
              ...current,
              data: withCanonicalAssociation(
                current.data,
                recordId,
                association,
              ),
            }
          : current,
    );
  }
  try {
    await updateExternalRecordAssociationSnapshots(offlineDatabase, {
      githubUserId,
      trackerKey,
      localDate,
      recordId,
      association,
    });
    await Promise.all(
      (["today", "day"] as const).map((kind) =>
        queryClient.invalidateQueries({
          queryKey: [
            "private-offline-snapshot",
            githubUserId,
            trackerKey,
            kind,
            localDate,
          ],
          exact: true,
        }),
      ),
    );
  } catch {
    // The server response and in-memory Query caches are already canonical.
    // A private IndexedDB failure must not turn the successful write into an
    // apparent association failure; a later online read can refresh snapshots.
  }
}

export async function refreshExternalRecordAssociationQueries(input: {
  queryClient: QueryClient;
  trackerKey: string;
  localDate: string;
}) {
  const { queryClient, trackerKey, localDate } = input;
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.today(trackerKey, localDate),
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.day(trackerKey, localDate),
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.calendar(trackerKey, localDate.slice(0, 7)),
      exact: true,
    }),
  ]);
}
