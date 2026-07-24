import { describe, expect, it } from "vitest";

import {
  type PlanChangeOperation,
  planChangeProposalSchema,
  planVersionSchema,
  schemaVersion,
} from "@/domain/schemas";
import { applyAcceptedPlanChange } from "@/domain/plan-change";

const base = planVersionSchema.parse({
  schemaVersion,
  id: "019bfe22-f969-7000-8000-000000000001",
  trackerKey: "knee-rehab",
  version: 1,
  effectiveFrom: "2026-07-16",
  createdAt: "2026-07-16T08:00:00+08:00",
  createdBy: "import",
  tasks: [
    {
      id: "task-a",
      title: "Anonymous historical task",
      scheduledDate: "2026-07-16",
      sortOrder: 0,
      category: "training",
      prescription: {},
    },
    {
      id: "task-b",
      title: "Anonymous future task",
      scheduledDate: "2026-07-18",
      sortOrder: 0,
      category: "training",
      prescription: {},
    },
  ],
});

function proposal(operations: PlanChangeOperation[]) {
  return planChangeProposalSchema.parse({
    schemaVersion,
    id: "019bfe22-f969-7000-8000-000000000010",
    trackerKey: "knee-rehab",
    basePlanVersionId: base.id,
    createdAt: "2026-07-16T09:00:00+08:00",
    safetyLevel: "green",
    summary: "Anonymous adjustment",
    operations,
    status: "accepted",
  });
}

const next = {
  id: "019bfe22-f969-7000-8000-000000000011",
  version: 2,
  effectiveFrom: "2026-07-17",
  createdAt: "2026-07-16T09:01:00+08:00",
};

describe("applyAcceptedPlanChange", () => {
  it("requires explicit acceptance", () => {
    const proposal = planChangeProposalSchema.parse({
      schemaVersion,
      id: "019bfe22-f969-7000-8000-000000000002",
      trackerKey: "knee-rehab",
      basePlanVersionId: base.id,
      createdAt: "2026-07-16T09:00:00+08:00",
      safetyLevel: "green",
      summary: "无需调整",
      operations: [],
      status: "proposed",
    });

    expect(() =>
      applyAcceptedPlanChange(base, proposal, {
        id: "019bfe22-f969-7000-8000-000000000003",
        version: 2,
        effectiveFrom: "2026-07-17",
        createdAt: "2026-07-16T09:01:00+08:00",
      }),
    ).toThrow("Only an accepted proposal");
  });

  it("blocks red proposals from automatic application", () => {
    const proposal = planChangeProposalSchema.parse({
      schemaVersion,
      id: "019bfe22-f969-7000-8000-000000000004",
      trackerKey: "knee-rehab",
      basePlanVersionId: base.id,
      createdAt: "2026-07-16T09:00:00+08:00",
      safetyLevel: "red",
      summary: "停止并人工处理",
      operations: [],
      status: "accepted",
    });

    expect(() =>
      applyAcceptedPlanChange(base, proposal, {
        id: "019bfe22-f969-7000-8000-000000000005",
        version: 2,
        effectiveFrom: "2026-07-17",
        createdAt: "2026-07-16T09:01:00+08:00",
      }),
    ).toThrow("Red safety proposals");
  });

  it("preserves history and applies a valid complete future-plan change", () => {
    const result = applyAcceptedPlanChange(
      base,
      proposal([
        {
          type: "replace_task",
          taskId: "task-b",
          task: {
            id: "task-b",
            title: "Anonymous adjusted future task",
            scheduledDate: "2026-07-19",
            sortOrder: 0,
            category: "training",
            prescription: {},
          },
          reason: "Anonymous reason",
        },
        {
          type: "add_task",
          task: {
            id: "task-c",
            title: "Anonymous added task",
            scheduledDate: "2026-07-20",
            sortOrder: 0,
            category: "training",
            prescription: {},
          },
          reason: "Anonymous reason",
        },
      ]),
      next,
    );

    expect(result.tasks).toEqual([
      base.tasks[0],
      expect.objectContaining({
        id: "task-b",
        scheduledDate: "2026-07-19",
      }),
      expect.objectContaining({
        id: "task-c",
        scheduledDate: "2026-07-20",
      }),
    ]);
  });

  it.each([
    {
      name: "removes a historical task",
      operations: [
        {
          type: "remove_task" as const,
          taskId: "task-a",
          reason: "Anonymous reason",
        },
      ],
    },
    {
      name: "replaces a task with a pre-effective date",
      operations: [
        {
          type: "replace_task" as const,
          taskId: "task-b",
          task: {
            id: "task-b",
            title: "Anonymous invalid task",
            scheduledDate: "2026-07-16",
            sortOrder: 0,
            category: "training",
            prescription: {},
          },
          reason: "Anonymous reason",
        },
      ],
    },
    {
      name: "targets a missing task",
      operations: [
        {
          type: "remove_task" as const,
          taskId: "missing-task",
          reason: "Anonymous reason",
        },
      ],
    },
    {
      name: "changes one task more than once",
      operations: [
        {
          type: "remove_task" as const,
          taskId: "task-b",
          reason: "Anonymous reason",
        },
        {
          type: "remove_task" as const,
          taskId: "task-b",
          reason: "Anonymous duplicate reason",
        },
      ],
    },
    {
      name: "adds a duplicate task id",
      operations: [
        {
          type: "add_task" as const,
          task: {
            id: "task-b",
            title: "Anonymous duplicate task",
            scheduledDate: "2026-07-20",
            sortOrder: 0,
            category: "training",
            prescription: {},
          },
          reason: "Anonymous reason",
        },
      ],
    },
  ])("rejects an unsafe operation that $name", ({ operations }) => {
    expect(() =>
      applyAcceptedPlanChange(base, proposal(operations), next),
    ).toThrow();
  });
});
