// @vitest-environment node

import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type { TodayAggregate } from "@/domain/api-contracts";
import {
  enqueuePendingCommand,
  finalizePendingCommandSuccess,
} from "@/offline/pending-commands";
import {
  prepareOfflineIdentity,
  readQuerySnapshot,
  saveQuerySnapshot,
} from "@/offline/query-snapshots";
import {
  offlineCalendarSnapshotSchema,
  offlineDaySnapshotSchema,
  offlineTodaySnapshotSchema,
} from "@/offline/snapshot-contracts";
import {
  createOfflineDatabase,
  type TrackerOfflineDatabase,
} from "@/offline/store";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const databases: TrackerOfflineDatabase[] = [];
const commandId = "019c0000-0000-7000-8000-000000000601";
const taskId = "019c0000-0000-7000-8000-000000000602";

function database() {
  const instance = createOfflineDatabase(
    `ak-tracker-finalize-${crypto.randomUUID()}`,
  );
  databases.push(instance);
  return instance;
}

function aggregate(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-20",
    plan: {
      id: "019c0000-0000-7000-8000-000000000603",
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
      policyId: "019c0000-0000-7000-8000-000000000604",
      trackerKey: "knee-rehab",
      version: 1,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "import",
      rules: [],
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

afterEach(async () => {
  await Promise.all(databases.splice(0).map((instance) => instance.delete()));
});

describe("P2b-1 canonical snapshot finalization", () => {
  it("atomically projects the canonical task result into all cached views before deleting the command", async () => {
    const db = database();
    const data = aggregate();
    const savedAt = "2026-07-20T09:00:00.000Z";
    const expiresAt = "2026-08-20T09:00:00.000Z";
    await prepareOfflineIdentity(db, "10001");
    await Promise.all([
      saveQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "today",
        scope: "2026-07-20",
        savedAt,
        expiresAt,
        sourceVersion: "today-v1",
        data: {
          tracker: data.tracker,
          targetDate: data.targetDate,
          plan: data.plan,
          day: data.day,
          safetyPolicy: {
            policyId: data.safetyPolicy.policyId,
            version: data.safetyPolicy.version,
            hash: data.safetyPolicy.hash,
          },
          execution: data.execution,
        },
      }),
      saveQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "day",
        scope: "2026-07-20",
        savedAt,
        expiresAt,
        sourceVersion: "day-v1",
        data: {
          trackerKey: "knee-rehab",
          targetDate: "2026-07-20",
          plan: data.plan,
          day: data.day,
        },
      }),
      saveQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "calendar-month",
        scope: "2026-07",
        savedAt,
        expiresAt,
        sourceVersion: "month-v1",
        data: {
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
        },
      }),
    ]);
    const command = await enqueuePendingCommand(db, {
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

    await finalizePendingCommandSuccess(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      command,
      result: {
        kind: "task_update",
        commandId,
        status: "completed",
        replayed: false,
      },
      savedAt: "2026-07-20T10:01:00.000Z",
    });

    const [today, day, month] = await Promise.all([
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
    const todayData = offlineTodaySnapshotSchema.parse(today?.data);
    const dayData = offlineDaySnapshotSchema.parse(day?.data);
    const monthData = offlineCalendarSnapshotSchema.parse(month?.data);
    expect(todayData.day.tasks[0]).toMatchObject({
      status: "completed",
      subjectiveNote: "Anonymous note",
    });
    expect(dayData.day.tasks[0]?.status).toBe("completed");
    expect(monthData.days[0]?.completedCount).toBe(1);
    expect(await db.pendingCommands.get(commandId)).toBeUndefined();
  });
});
