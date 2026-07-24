"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import { garminActivityRecoveryResponseSchema } from "@/domain/garmin";

const recoveryThrottleMs = 60_000;

export function GarminActivityRecovery({ trackerKey }: { trackerKey: string }) {
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
        `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin/recovery`,
        { method: "POST" },
      )
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            lifecycleBlocked = true;
          }
          if (!response.ok) return;
          const parsed = garminActivityRecoveryResponseSchema.safeParse(
            await response.json(),
          );
          if (!parsed.success || disposed) return;

          queryClient.setQueryData(
            integrationQueryKeys.providerStatus(trackerKey, "garmin"),
            parsed.data.connection,
          );
          if (
            parsed.data.connection.state === "needs_refresh" ||
            (parsed.data.status === "skipped" &&
              parsed.data.reason === "needs_refresh")
          ) {
            lifecycleBlocked = true;
          }
          if (parsed.data.status !== "completed") return;

          const affectedDates = parsed.data.sync.days
            .filter((day) => day.status === "succeeded")
            .map((day) => day.date);
          const affectedMonths = [
            ...new Set(affectedDates.map((date) => date.slice(0, 7))),
          ];
          void Promise.all([
            ...affectedDates.flatMap((date) => [
              queryClient.invalidateQueries({
                queryKey: trackerQueryKeys.today(trackerKey, date),
                exact: true,
              }),
              queryClient.invalidateQueries({
                queryKey: trackerQueryKeys.day(trackerKey, date),
                exact: true,
              }),
            ]),
            ...affectedMonths.map((month) =>
              queryClient.invalidateQueries({
                queryKey: trackerQueryKeys.calendar(trackerKey, month),
                exact: true,
              }),
            ),
          ]).catch(() => undefined);
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
