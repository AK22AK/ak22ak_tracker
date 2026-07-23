"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { integrationQueryKeys } from "@/client/query-keys";
import { githubMirrorSyncResponseSchema } from "@/domain/github-mirror";

const RECOVERY_THROTTLE_MS = 60_000;

export function GitHubMirrorRecovery() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let lastAttemptAt = Number.NEGATIVE_INFINITY;
    let inFlight = false;
    let authenticationBlocked = false;
    let disposed = false;

    const recover = () => {
      const now = Date.now();
      if (
        !navigator.onLine ||
        authenticationBlocked ||
        inFlight ||
        now - lastAttemptAt < RECOVERY_THROTTLE_MS
      ) {
        return;
      }
      lastAttemptAt = now;
      inFlight = true;
      void fetch("/api/mirror/sync", { method: "POST" })
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            authenticationBlocked = true;
          }
          if (!response.ok) return;

          const parsed = githubMirrorSyncResponseSchema.parse(
            await response.json(),
          );
          if (!disposed) {
            queryClient.setQueryData(
              integrationQueryKeys.githubMirrorStatus(),
              parsed.status,
            );
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    recover();
    window.addEventListener("online", recover);
    return () => {
      disposed = true;
      window.removeEventListener("online", recover);
    };
  }, [queryClient]);

  return null;
}
