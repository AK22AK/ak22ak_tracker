// @vitest-environment node

import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CalendarAggregate,
  DayAggregate,
  TodayAggregate,
} from "@/domain/api-contracts";
import {
  discardNeedsAttentionHead,
  enqueuePendingCommand,
  listPendingCommands,
} from "@/offline/pending-commands";
import {
  prepareOfflineIdentity,
  readQuerySnapshot,
  saveQuerySnapshot,
} from "@/offline/query-snapshots";
import {
  projectCalendarPendingCommands,
  projectDayPendingCommands,
  projectTodayPendingCommands,
} from "@/offline/command-projection";
import {
  createOfflineDatabase,
  type TrackerOfflineDatabase,
} from "@/offline/store";
import {
  offlineCalendarSnapshotSchema,
  offlineDaySnapshotSchema,
  offlineTodaySnapshotSchema,
} from "@/offline/snapshot-contracts";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const databases: TrackerOfflineDatabase[] = [];
const commandId = "019c0000-0000-7000-8000-000000000801";
const laterCommandId = "019c0000-0000-7000-8000-000000000802";
const taskId = "019c0000-0000-7000-8000-000000000803";

function database() {
  const instance = createOfflineDatabase(
    `ak-tracker-discard-${crypto.randomUUID()}`,
  );
  databases.push(instance);
  return instance;
}

function canonicalToday(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-20",
    plan: {
      id: "019c0000-0000-7000-8000-000000000804",
      version: 1,
      effectiveFrom: "2026-07-01",
    },
    day: {
      state: "ready",
      trackerName: "Anonymous Tracker",
      startDate: "2026-07-01",
      planVersion: 1,
      tasks: [
        {
          id: taskId,
          title: "Anonymous task",
          category: "general",
          prescription: { main: "Anonymous dose" },
          status: "planned",
          actual: null,
          subjectiveNote: null,
        },
      ],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [],
    },
    safetyPolicy: {
      schemaVersion: "1.0.0",
      policyId: "019c0000-0000-7000-8000-000000000805",
      trackerKey: "knee-rehab",
      version: 1,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "import",
      rules: [
        {
          id: "anonymous-warning",
          outcome: "yellow",
          match: "all",
          conditions: [{ operator: "number_gte", field: "score", value: 999 }],
        },
      ],
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    execution: {
      context: null,
      day: null,
      alternatives: [],
      safety: { blocked: false, reason: null },
    },
  };
}

function canonicalDay(today: TodayAggregate): DayAggregate {
  return {
    trackerKey: today.tracker.key,
    targetDate: today.targetDate,
    plan: today.plan,
    day: today.day,
  };
}

function canonicalCalendar(): CalendarAggregate {
  return {
    trackerKey: "knee-rehab",
    month: "2026-07",
    days: [
      {
        date: "2026-07-20",
        taskCount: 1,
        completedCount: 0,
        skippedCount: 0,
        feedbackCount: 0,
      },
    ],
  };
}

async function seedQueue(db: TrackerOfflineDatabase) {
  await prepareOfflineIdentity(db, "10001");
  await enqueuePendingCommand(db, {
    id: commandId,
    githubUserId: "10001",
    trackerKey: "knee-rehab",
    kind: "task_update",
    createdAt: "2026-07-20T10:00:00.000Z",
    occurredAt: "2026-07-20T10:00:00.000Z",
    localDate: "2026-07-20",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    payload: {
      taskId,
      status: "completed",
      actual: null,
      note: "Anonymous note",
      baseStatus: "planned",
      planVersion: 1,
    },
  });
  const head = await db.pendingCommands.get(commandId);
  await db.pendingCommands.put({
    ...head!,
    status: "needs_attention",
    lastErrorCode: "version_conflict",
  });
  await enqueuePendingCommand(db, {
    id: laterCommandId,
    githubUserId: "10001",
    trackerKey: "knee-rehab",
    kind: "symptom_check_in",
    createdAt: "2026-07-20T10:01:00.000Z",
    occurredAt: "2026-07-20T10:01:00.000Z",
    localDate: "2026-07-20",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    payload: {
      checkIn: {
        timing: "post_training",
        leftPain: 0,
        rightPain: 0,
        swelling: "none",
        stiffness: false,
        mechanicalSymptoms: false,
        weightBearingIssue: false,
        localizedBonePain: false,
        nightOrRestPain: false,
        note: "Anonymous feedback",
      },
      clientSafetyPolicy: null,
      localSafetyLevel: "green",
    },
  });
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((instance) => instance.delete()));
});

describe("P2b-2 atomic queue-head discard", () => {
  it("replaces optimistic snapshots with canonical data, removes only the head, and keeps later projection", async () => {
    const db = database();
    const today = canonicalToday();
    await seedQueue(db);
    const optimistic = projectTodayPendingCommands(
      today,
      await listPendingCommands(db, "10001", "knee-rehab"),
    ).data;
    await saveQuerySnapshot(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-20",
      savedAt: "2026-07-20T10:01:00.000Z",
      expiresAt: "2026-08-20T10:01:00.000Z",
      sourceVersion: "optimistic-v1",
      data: optimistic,
    });

    const result = await discardNeedsAttentionHead(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      commandId,
      canonical: {
        today,
        day: canonicalDay(today),
        calendar: canonicalCalendar(),
      },
      savedAt: "2026-07-20T10:05:00.000Z",
    });

    expect(result.discarded.id).toBe(commandId);
    expect(result.remaining.map((command) => command.id)).toEqual([
      laterCommandId,
    ]);
    const pending = await listPendingCommands(db, "10001", "knee-rehab");
    expect(pending.map((command) => command.id)).toEqual([laterCommandId]);
    const [todayRow, dayRow, monthRow] = await Promise.all([
      readQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "today",
        scope: "2026-07-20",
      }),
      readQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "day",
        scope: "2026-07-20",
      }),
      readQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "calendar-month",
        scope: "2026-07",
      }),
    ]);
    const restoredToday = offlineTodaySnapshotSchema.parse(todayRow!.data);
    const restoredDay = offlineDaySnapshotSchema.parse(dayRow!.data);
    const restoredMonth = offlineCalendarSnapshotSchema.parse(monthRow!.data);
    expect(
      projectTodayPendingCommands(restoredToday, pending).data.day,
    ).toMatchObject({
      tasks: [expect.objectContaining({ status: "planned" })],
      feedbackCount: 1,
    });
    expect(
      projectDayPendingCommands(restoredDay, pending).data.day,
    ).toMatchObject({
      tasks: [expect.objectContaining({ status: "planned" })],
      feedbackCount: 1,
    });
    expect(
      projectCalendarPendingCommands(restoredMonth, pending).days[0],
    ).toMatchObject({
      completedCount: 0,
      feedbackCount: 0,
      localPendingCount: 1,
    });
  });

  it("rejects a non-head command and allows only one concurrent discard", async () => {
    const db = database();
    const today = canonicalToday();
    await seedQueue(db);
    const input = {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      commandId,
      canonical: {
        today,
        day: canonicalDay(today),
        calendar: canonicalCalendar(),
      },
      savedAt: "2026-07-20T10:05:00.000Z",
    };

    await expect(
      discardNeedsAttentionHead(db, {
        ...input,
        commandId: laterCommandId,
      }),
    ).rejects.toThrow("offline_command_not_queue_head");
    const results = await Promise.allSettled([
      discardNeedsAttentionHead(db, input),
      discardNeedsAttentionHead(db, input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.pendingCommands.get(laterCommandId)).toBeDefined();
  });
});
