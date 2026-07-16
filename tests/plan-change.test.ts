import { describe, expect, it } from "vitest";

import {
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
      title: "示例任务",
      scheduledDate: "2026-07-16",
      sortOrder: 0,
      category: "training",
      prescription: {},
    },
  ],
});

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
});
