"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  fetchCalendarAggregate,
  fetchDayAggregate,
  fetchTodayAggregate,
} from "@/client/tracker-api";
import type {
  CalendarAggregate,
  DayAggregate,
  TodayAggregate,
} from "@/domain/api-contracts";

import type { PendingCommand, PendingCommandInput } from "./command-contracts";
import {
  isCommandCountReflectedInDashboard,
  projectCalendarCanonicalCommand,
  projectDayPendingCommands,
  projectTodayPendingCommands,
} from "./command-projection";
import { sendPendingCommand } from "./command-transport";
import {
  canonicalProjectionCommand,
  discardNeedsAttentionHead,
  enqueuePendingCommand,
  finalizePendingCommandSuccess,
  listPendingCommands,
} from "./pending-commands";
import { prepareOfflineIdentity } from "./query-snapshots";
import { replayPendingCommands } from "./replay";
import { offlineDatabase } from "./store";
import { privateOfflineSnapshotQueryKey } from "./use-query-snapshot";

type OfflineCommandContextValue = {
  commands: PendingCommand[];
  confirmedCommandIds: string[];
  ready: boolean;
  enqueue: (input: PendingCommandInput) => Promise<PendingCommand>;
  replayNow: () => Promise<void>;
  discardNeedsAttentionHead: (commandId: string) => Promise<void>;
};

const OfflineCommandContext = createContext<OfflineCommandContextValue | null>(
  null,
);

const detachedOfflineCommands: OfflineCommandContextValue = {
  commands: [],
  confirmedCommandIds: [],
  ready: true,
  enqueue: async () => {
    throw new Error("offline_command_provider_missing");
  },
  replayNow: async () => undefined,
  discardNeedsAttentionHead: async () => {
    throw new Error("offline_command_provider_missing");
  },
};

function applyCanonicalToQueryCache(
  queryClient: ReturnType<typeof useQueryClient>,
  command: PendingCommand,
  projected: PendingCommand,
) {
  const todayKey = trackerQueryKeys.today(
    command.trackerKey,
    command.localDate,
  );
  const dayKey = trackerQueryKeys.day(command.trackerKey, command.localDate);
  const currentToday = queryClient.getQueryData<TodayAggregate>(todayKey);
  const currentDay = queryClient.getQueryData<DayAggregate>(dayKey);
  const detailedDashboard = currentToday?.day ?? currentDay?.day;
  const countAlreadyReflected = detailedDashboard
    ? isCommandCountReflectedInDashboard(detailedDashboard, command)
    : null;
  queryClient.setQueryData<TodayAggregate>(todayKey, (current) =>
    current ? projectTodayPendingCommands(current, [projected]).data : current,
  );
  queryClient.setQueryData<DayAggregate>(dayKey, (current) =>
    current ? projectDayPendingCommands(current, [projected]).data : current,
  );
  const calendarKey = trackerQueryKeys.calendar(
    command.trackerKey,
    command.localDate.slice(0, 7),
  );
  if (countAlreadyReflected === false) {
    queryClient.setQueryData<CalendarAggregate>(calendarKey, (current) =>
      current ? projectCalendarCanonicalCommand(current, projected) : current,
    );
  } else if (countAlreadyReflected === null) {
    void queryClient.invalidateQueries({ queryKey: calendarKey });
  }
}

export function OfflineCommandProvider({
  githubUserId,
  children,
}: {
  githubUserId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [commands, setCommands] = useState<PendingCommand[]>([]);
  const [confirmedCommandIds, setConfirmedCommandIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const ownerId = useRef(
    typeof crypto === "undefined" ? "offline-page" : crypto.randomUUID(),
  );
  const replaying = useRef<Promise<void> | null>(null);
  const discarding = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    setCommands(
      await listPendingCommands(offlineDatabase, githubUserId, "knee-rehab"),
    );
  }, [githubUserId]);

  const runReplay = useCallback(
    async (force = false) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (replaying.current) return replaying.current;
      const run = (async () => {
        await prepareOfflineIdentity(offlineDatabase, githubUserId);
        await replayPendingCommands(offlineDatabase, {
          githubUserId,
          trackerKey: "knee-rehab",
          ownerId: ownerId.current,
          force,
          send: sendPendingCommand,
          onCommandStateChange: async () => refresh(),
          onCanonicalSuccess: async (command, result) => {
            const projected = canonicalProjectionCommand(command, result);
            applyCanonicalToQueryCache(queryClient, command, projected);
            await finalizePendingCommandSuccess(offlineDatabase, {
              githubUserId,
              trackerKey: command.trackerKey,
              command,
              result,
            });
            setConfirmedCommandIds((current) =>
              [...new Set([...current, command.id])].slice(-100),
            );
          },
        });
        await refresh();
      })().finally(() => {
        replaying.current = null;
      });
      replaying.current = run;
      return run;
    },
    [githubUserId, queryClient, refresh],
  );

  const replayNow = useCallback(() => runReplay(true), [runReplay]);

  const discardHead = useCallback(
    async (commandId: string) => {
      if (typeof navigator === "undefined" || !navigator.onLine) {
        throw new Error("offline_command_discard_requires_network");
      }
      if (discarding.current) return discarding.current;
      const operation = (async () => {
        await prepareOfflineIdentity(offlineDatabase, githubUserId);
        const current = await listPendingCommands(
          offlineDatabase,
          githubUserId,
          "knee-rehab",
        );
        const head = current[0];
        if (!head || head.id !== commandId) {
          throw new Error("offline_command_not_queue_head");
        }
        if (head.status !== "needs_attention") {
          throw new Error("offline_command_not_discardable");
        }
        const month = head.localDate.slice(0, 7);
        const [today, day, calendar] = await Promise.all([
          fetchTodayAggregate("knee-rehab", head.localDate),
          fetchDayAggregate("knee-rehab", head.localDate),
          fetchCalendarAggregate("knee-rehab", month),
        ]);
        const result = await discardNeedsAttentionHead(offlineDatabase, {
          githubUserId,
          trackerKey: "knee-rehab",
          commandId,
          canonical: { today, day, calendar },
        });
        queryClient.setQueryData(
          trackerQueryKeys.today("knee-rehab", head.localDate),
          today,
        );
        queryClient.setQueryData(
          trackerQueryKeys.day("knee-rehab", head.localDate),
          day,
        );
        queryClient.setQueryData(
          trackerQueryKeys.calendar("knee-rehab", month),
          calendar,
        );
        setCommands(result.remaining);
        await Promise.all(
          [
            privateOfflineSnapshotQueryKey(
              githubUserId,
              "knee-rehab",
              "today",
              head.localDate,
            ),
            privateOfflineSnapshotQueryKey(
              githubUserId,
              "knee-rehab",
              "day",
              head.localDate,
            ),
            privateOfflineSnapshotQueryKey(
              githubUserId,
              "knee-rehab",
              "calendar-month",
              month,
            ),
          ].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey, exact: true }),
          ),
        );
        const activeReplay = replaying.current;
        if (activeReplay) await activeReplay;
        await runReplay(true);
      })().finally(() => {
        discarding.current = null;
      });
      discarding.current = operation;
      return operation;
    },
    [githubUserId, queryClient, runReplay],
  );

  const enqueue = useCallback(
    async (input: PendingCommandInput) => {
      await prepareOfflineIdentity(offlineDatabase, githubUserId);
      const command = await enqueuePendingCommand(offlineDatabase, input);
      await refresh();
      if (typeof navigator === "undefined" || navigator.onLine) {
        const activeReplay = replaying.current;
        if (activeReplay) {
          void activeReplay.then(() => runReplay(false));
        } else {
          void runReplay(false);
        }
      }
      return command;
    },
    [githubUserId, refresh, runReplay],
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      await prepareOfflineIdentity(offlineDatabase, githubUserId);
      if (disposed) return;
      await refresh();
      if (disposed) return;
      setReady(true);
      void runReplay(false);
    })();
    const trigger = () => void runReplay(false);
    const visible = () => {
      if (document.visibilityState === "visible") trigger();
    };
    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      window.removeEventListener("online", trigger);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [githubUserId, refresh, runReplay]);

  const value = useMemo(
    () => ({
      commands,
      confirmedCommandIds,
      ready,
      enqueue,
      replayNow,
      discardNeedsAttentionHead: discardHead,
    }),
    [commands, confirmedCommandIds, discardHead, enqueue, ready, replayNow],
  );
  return (
    <OfflineCommandContext.Provider value={value}>
      {children}
    </OfflineCommandContext.Provider>
  );
}

export function useOfflineCommands() {
  const value = useContext(OfflineCommandContext);
  return value ?? detachedOfflineCommands;
}
