"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  garminActivityRecoveryResponseSchema,
  garminConnectionStatusSchema,
  garminWellnessRecoveryResponseSchema,
} from "@/domain/garmin";

const recoveryThrottleMs = 60_000;
const busyRetryDelayMs = 60_000;

type ActivityOutcome = "continue" | "blocked" | "busy";

export function GarminRecovery({ trackerKey }: { trackerKey: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let lastAttemptAt = Number.NEGATIVE_INFINITY;
    let inFlight = false;
    let lifecycleBlocked = false;
    let disposed = false;
    let busyRetry: ReturnType<typeof setTimeout> | null = null;
    const baseUrl = `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin`;

    const applyActivityResponse = async (
      response: Response,
    ): Promise<ActivityOutcome> => {
      if (response.status === 401 || response.status === 403) {
        lifecycleBlocked = true;
        return "blocked";
      }
      if (response.status === 409) return "busy";
      if (!response.ok) return "continue";
      const parsed = garminActivityRecoveryResponseSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success || disposed) return "continue";

      queryClient.setQueryData(
        integrationQueryKeys.providerStatus(trackerKey, "garmin"),
        parsed.data.connection,
      );
      if (
        parsed.data.status === "skipped" &&
        parsed.data.reason === "in_progress"
      ) {
        return "busy";
      }
      const authenticationFailed =
        parsed.data.connection.state === "needs_refresh" ||
        parsed.data.connection.state === "invalid" ||
        (parsed.data.status === "skipped" &&
          parsed.data.reason === "needs_refresh") ||
        (parsed.data.status === "completed" &&
          parsed.data.sync.days.some(
            (day) =>
              day.status === "failed" && day.errorCode === "authentication",
          ));
      if (authenticationFailed) {
        lifecycleBlocked = true;
        return "blocked";
      }
      if (parsed.data.status !== "completed") return "continue";

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
      return "continue";
    };

    const applyWellnessResponse = async (response: Response) => {
      if (response.status === 401 || response.status === 403) {
        lifecycleBlocked = true;
        return;
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
        lifecycleBlocked = true;
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
      if (parsed.data.status !== "completed") return;

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
    };

    const runSequence = async (allowBusyRetry: boolean) => {
      let activityOutcome: ActivityOutcome = "continue";
      try {
        activityOutcome = await applyActivityResponse(
          await fetch(`${baseUrl}/recovery`, { method: "POST" }),
        );
      } catch {
        activityOutcome = "continue";
      }
      if (activityOutcome === "blocked") return;
      if (activityOutcome === "busy") {
        if (allowBusyRetry && busyRetry === null) {
          busyRetry = setTimeout(() => {
            busyRetry = null;
            if (disposed || lifecycleBlocked || !navigator.onLine || inFlight) {
              return;
            }
            lastAttemptAt = Date.now();
            inFlight = true;
            void runSequence(false).finally(() => {
              inFlight = false;
            });
          }, busyRetryDelayMs);
        }
        return;
      }

      try {
        await applyWellnessResponse(
          await fetch(`${baseUrl}/wellness/recovery`, { method: "POST" }),
        );
      } catch {
        // A temporary wellness failure is isolated from the protected App Shell.
      }
    };

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
      void runSequence(true).finally(() => {
        inFlight = false;
      });
    };

    recover();
    window.addEventListener("online", recover);
    return () => {
      disposed = true;
      if (busyRetry !== null) clearTimeout(busyRetry);
      window.removeEventListener("online", recover);
    };
  }, [queryClient, trackerKey]);

  return null;
}
