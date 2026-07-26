"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  garminConnectionStatusSchema,
  garminWellnessRecoveryResponseSchema,
} from "@/domain/garmin";

const recoveryThrottleMs = 60_000;

export function GarminWellnessRecovery({ trackerKey }: { trackerKey: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let lastAttemptAt = Number.NEGATIVE_INFINITY;
    let inFlight = false;
    let lifecycleBlocked = false;
    let disposed = false;

    const recover = () => {
      const currentTime = Date.now();
      if (
        !navigator.onLine ||
        lifecycleBlocked ||
        inFlight ||
        currentTime - lastAttemptAt < recoveryThrottleMs
      ) {
        return;
      }
      lastAttemptAt = currentTime;
      inFlight = true;
      void fetch(
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin/wellness/recovery`,
        { method: "POST" },
      )
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            lifecycleBlocked = true;
          }
          if (!response.ok) return;
          const parsed = garminWellnessRecoveryResponseSchema.safeParse(
            await response.json(),
          );
          if (!parsed.success || disposed) return;

          queryClient.setQueryData(
            integrationQueryKeys.providerStatus(trackerKey, "garmin_wellness"),
            parsed.data.progress,
          );
          const authenticationFailed =
            (parsed.data.status === "skipped" &&
              parsed.data.reason === "needs_refresh") ||
            (parsed.data.status === "completed" &&
              parsed.data.sync.days.some(
                (day) =>
                  day.status === "failed" && day.errorCode === "authentication",
              ));
          if (authenticationFailed) {
            queryClient.setQueryData(
              integrationQueryKeys.providerStatus(trackerKey, "garmin"),
              (current: unknown) => {
                const status = garminConnectionStatusSchema.safeParse(current);
                return status.success
                  ? {
                      ...status.data,
                      state: "needs_refresh" as const,
                      lastErrorCode: "authentication" as const,
                    }
                  : current;
              },
            );
          }
          if (
            parsed.data.status === "skipped" &&
            parsed.data.reason === "needs_refresh"
          ) {
            lifecycleBlocked = true;
          }
          if (parsed.data.status !== "completed") return;
          if (
            parsed.data.sync.days.some(
              (day) =>
                day.status === "failed" && day.errorCode === "authentication",
            )
          ) {
            lifecycleBlocked = true;
          }
          const affectedDates = parsed.data.sync.days
            .filter((day) => day.status === "succeeded")
            .map((day) => day.date);
          void Promise.all(
            affectedDates.flatMap((date) => [
              queryClient.invalidateQueries({
                queryKey: trackerQueryKeys.today(trackerKey, date),
                exact: true,
              }),
              queryClient.invalidateQueries({
                queryKey: trackerQueryKeys.day(trackerKey, date),
                exact: true,
              }),
            ]),
          ).catch(() => undefined);
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
  }, [queryClient, trackerKey]);

  return null;
}
