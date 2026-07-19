"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  prepareOfflineIdentity,
  readQuerySnapshot,
  saveQuerySnapshot,
} from "./query-snapshots";
import { usePrivateOfflineIdentity } from "./private-offline-context";
import { offlineDatabase, type QuerySnapshotKind } from "./store";

const snapshotLifetimeMs: Record<QuerySnapshotKind, number> = {
  today: 7 * 24 * 60 * 60 * 1_000,
  "calendar-month": 35 * 24 * 60 * 60 * 1_000,
  day: 35 * 24 * 60 * 60 * 1_000,
};

export function useQuerySnapshot<T>({
  trackerKey,
  kind,
  scope,
}: {
  trackerKey: string;
  kind: QuerySnapshotKind;
  scope: string;
}) {
  const githubUserId = usePrivateOfflineIdentity();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () =>
      [
        "private-offline-snapshot",
        githubUserId,
        trackerKey,
        kind,
        scope,
      ] as const,
    [githubUserId, kind, scope, trackerKey],
  );
  const snapshot = useQuery({
    queryKey,
    queryFn: () =>
      githubUserId
        ? readQuerySnapshot(offlineDatabase, {
            githubUserId,
            trackerKey,
            kind,
            scope,
          })
        : null,
    enabled: githubUserId !== null,
    networkMode: "always",
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const persist = useCallback(
    async (data: T, sourceVersion: string, dataUpdatedAt?: number) => {
      if (!githubUserId) return;
      const savedAt = new Date(dataUpdatedAt || Date.now());
      try {
        await prepareOfflineIdentity(offlineDatabase, githubUserId);
        await saveQuerySnapshot(offlineDatabase, {
          githubUserId,
          trackerKey,
          kind,
          scope,
          data,
          savedAt: savedAt.toISOString(),
          expiresAt: new Date(
            savedAt.getTime() + snapshotLifetimeMs[kind],
          ).toISOString(),
          sourceVersion,
        });
        await queryClient.invalidateQueries({ queryKey, exact: true });
      } catch {
        // An IndexedDB failure must not turn a successful server read into an
        // application error. The next successful online read can try again.
      }
    },
    [githubUserId, kind, queryClient, queryKey, scope, trackerKey],
  );

  return {
    ...snapshot,
    isPending: githubUserId ? snapshot.isPending : false,
    isError: githubUserId ? snapshot.isError : false,
    data: snapshot.data as
      | ({ data: T; savedAt: string; sourceVersion: string } & Record<
          string,
          unknown
        >)
      | null
      | undefined,
    persist,
  };
}
