"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import {
  integrationRecoveryResponseSchema,
  integrationStatusSchema,
} from "@/domain/integrations";
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
    let sessionBlocked = false;
    let garminBlocked = false;
    let xunjiBlocked = false;
    let disposed = false;
    let busyRetry: ReturnType<typeof setTimeout> | null = null;
    const baseUrl = `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/garmin`;

    const applyActivityResponse = async (
      response: Response,
    ): Promise<ActivityOutcome> => {
      if (response.status === 401 || response.status === 403) {
        sessionBlocked = true;
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
        garminBlocked = true;
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
        sessionBlocked = true;
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
        garminBlocked = true;
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

    const recoverXunji = async () => {
      if (xunjiBlocked || sessionBlocked) return;
      const xunjiStatusKey = integrationQueryKeys.providerStatus(
        trackerKey,
        "xunji",
      );
      queryClient.setQueryData(xunjiStatusKey, (current: unknown) => {
        const status = integrationStatusSchema.safeParse(current);
        return status.success
          ? {
              ...status.data,
              sync: {
                ...status.data.sync,
                status: "running" as const,
                lastOutcome: { kind: "in_progress" as const },
              },
            }
          : current;
      });
      try {
        const response = await fetch(
          `/api/trackers/${encodeURIComponent(trackerKey)}/integrations/xunji/recovery`,
          { method: "POST" },
        );
        if (response.status === 401 || response.status === 403) {
          sessionBlocked = true;
          return;
        }
        if (!response.ok) return;
        const parsed = integrationRecoveryResponseSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success || disposed) return;
        const recovery = parsed.data;
        if (recovery.status !== "completed") {
          void queryClient.invalidateQueries({
            queryKey: xunjiStatusKey,
            exact: true,
          });
          return;
        }
        const authenticationFailed = recovery.sync.days.some(
          (day) =>
            day.status === "failed" && day.errorCode === "authentication",
        );
        if (authenticationFailed) xunjiBlocked = true;
        const failed = recovery.sync.days.find(
          (day) => day.status === "failed",
        );
        const recordCount = recovery.sync.days.reduce(
          (total, day) =>
            total + (day.status === "succeeded" ? day.recordCount : 0),
          0,
        );
        queryClient.setQueryData(xunjiStatusKey, (current: unknown) => {
          const status = integrationStatusSchema.safeParse(current);
          if (!status.success) return current;
          return {
            ...status.data,
            sync: {
              ...status.data.sync,
              status: failed
                ? ("failed" as const)
                : recovery.sync.complete
                  ? ("succeeded" as const)
                  : ("running" as const),
              lastSucceededDate:
                recovery.sync.lastSucceededDate ??
                status.data.sync.lastSucceededDate,
              nextCursor: recovery.sync.nextCursor,
              lastErrorCode: failed?.errorCode ?? null,
              lastOutcome: failed
                ? {
                    kind: "failed" as const,
                    errorCode: failed.errorCode,
                    ...(failed.retryAfterMs === undefined
                      ? {}
                      : { retryAfterMs: failed.retryAfterMs }),
                  }
                : {
                    kind:
                      recordCount > 0
                        ? ("succeeded_with_records" as const)
                        : ("succeeded_empty" as const),
                  },
            },
          };
        });
        const affectedDates = recovery.sync.days
          .filter((day) => day.status === "succeeded")
          .map((day) => day.date);
        const months = [
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
          ...months.map((month) =>
            queryClient.invalidateQueries({
              queryKey: trackerQueryKeys.calendar(trackerKey, month),
              exact: true,
            }),
          ),
        ]).catch(() => undefined);
      } catch {
        // Xunji recovery is isolated from the protected App Shell.
        void queryClient.invalidateQueries({
          queryKey: xunjiStatusKey,
          exact: true,
        });
      }
    };

    const runSequence = async (allowBusyRetry: boolean) => {
      let activityOutcome: ActivityOutcome = garminBlocked
        ? "blocked"
        : "continue";
      if (!garminBlocked) {
        try {
          activityOutcome = await applyActivityResponse(
            await fetch(`${baseUrl}/recovery`, { method: "POST" }),
          );
        } catch {
          activityOutcome = "continue";
        }
      }
      if (activityOutcome === "busy") {
        if (allowBusyRetry && busyRetry === null) {
          busyRetry = setTimeout(() => {
            busyRetry = null;
            if (disposed || sessionBlocked || !navigator.onLine || inFlight) {
              return;
            }
            lastAttemptAt = Date.now();
            inFlight = true;
            void runSequence(false).finally(() => {
              inFlight = false;
            });
          }, busyRetryDelayMs);
        }
        await recoverXunji();
        return;
      }

      if (!garminBlocked && activityOutcome !== "blocked") {
        try {
          await applyWellnessResponse(
            await fetch(`${baseUrl}/wellness/recovery`, { method: "POST" }),
          );
        } catch {
          // A temporary wellness failure is isolated from the protected App Shell.
        }
      }
      await recoverXunji();
    };

    const recover = () => {
      const currentTime = Date.now();
      if (
        !navigator.onLine ||
        sessionBlocked ||
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
