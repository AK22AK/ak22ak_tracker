import { describe, expect, it } from "vitest";

import {
  aiAnalysisJobAuditDocumentSchema,
  createAiAnalysisJobAuditDocument,
  createPlanChangeProposalAuditDocument,
  planChangeProposalAuditDocumentSchema,
} from "@/domain/ai-audit";
import { schemaVersion } from "@/domain/schemas";
import {
  aiAnalysisJobMirrorPath,
  assertMirrorTargetPath,
  planChangeProposalMirrorPath,
} from "@/server/mirror/path";

const jobId = "019d1000-0000-7000-8000-000000000101";
const proposalId = "019d1000-0000-7000-8000-000000000102";
const basePlanVersionId = "019d1000-0000-7000-8000-000000000103";
const appliedPlanVersionId = "019d1000-0000-7000-8000-000000000104";
const rollbackPlanVersionId = "019d1000-0000-7000-8000-000000000105";

describe("AI audit mirror contracts", () => {
  it("projects a job to the audit whitelist without prompt, context, identity, or credentials", () => {
    const document = createAiAnalysisJobAuditDocument({
      id: jobId,
      trackerKey: "anonymous-tracker",
      proposalId,
      status: "succeeded",
      errorCode: null,
      provider: "anonymous-provider",
      model: "anonymous-model",
      attemptCount: 1,
      contextVersion: "3",
      contextHash: "a".repeat(64),
      contextRevision: 3,
      contextFrom: "2026-07-11",
      contextThrough: "2026-07-24",
      basePlanVersionId,
      timelineHeadPlanVersionId: basePlanVersionId,
      safetyLevel: "green",
      responseHash: "b".repeat(64),
      requestedAt: "2026-07-24T08:00:00.000Z",
      startedAt: "2026-07-24T08:00:01.000Z",
      completedAt: "2026-07-24T08:00:02.000Z",
    });

    expect(aiAnalysisJobAuditDocumentSchema.parse(document)).toEqual(document);
    expect(document).toMatchObject({
      schemaVersion,
      kind: "ai_analysis_job",
      id: jobId,
      proposalId,
      context: {
        version: "3",
        hash: "a".repeat(64),
        range: { from: "2026-07-11", through: "2026-07-24" },
      },
    });
    const serialized = JSON.stringify(document);
    for (const forbidden of [
      "prompt",
      "rawResponse",
      "modelContext",
      "githubUserId",
      "authorization",
      "apiKey",
      "feedbackNote",
      "trainingSummary",
      "sourceConversation",
      "rehabProfile",
      "assistantMemories",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps a validated proposal and its decision/rollback relationship readable", () => {
    const document = createPlanChangeProposalAuditDocument({
      analysisJobId: jobId,
      model: "anonymous-model",
      contextVersion: "3",
      contextHash: "a".repeat(64),
      contextFrom: "2026-07-11",
      contextThrough: "2026-07-24",
      timelineHeadPlanVersionId: basePlanVersionId,
      proposal: {
        schemaVersion,
        id: proposalId,
        trackerKey: "anonymous-tracker",
        basePlanVersionId,
        createdAt: "2026-07-24T08:00:02.000Z",
        safetyLevel: "green",
        summary: "Anonymous structured suggestion",
        operations: [
          {
            type: "set_plan_note",
            note: "Anonymous plan note",
            reason: "Anonymous reason",
          },
        ],
        status: "accepted",
      },
      decision: {
        id: "019d1000-0000-7000-8000-000000000106",
        type: "accepted",
        decidedAt: "2026-07-24T09:00:00.000Z",
        appliedPlanVersionId,
        effectiveFrom: "2026-07-25",
      },
      rollback: {
        id: "019d1000-0000-7000-8000-000000000107",
        sourceAppliedPlanVersionId: appliedPlanVersionId,
        targetBasePlanVersionId: basePlanVersionId,
        newPlanVersionId: rollbackPlanVersionId,
        effectiveFrom: "2026-07-25",
        decidedAt: "2026-07-24T10:00:00.000Z",
      },
    });

    expect(planChangeProposalAuditDocumentSchema.parse(document)).toEqual(
      document,
    );
    expect(document).toMatchObject({
      kind: "plan_change_proposal",
      id: proposalId,
      status: "accepted",
      decision: { type: "accepted", appliedPlanVersionId },
      rollback: { newPlanVersionId: rollbackPlanVersionId },
    });
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("rawResponse");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("providerRecordId");
  });

  it("uses stable safe paths for one job document and one proposal document", () => {
    const jobPath = aiAnalysisJobMirrorPath({
      trackerKey: "anonymous-tracker",
      id: jobId,
    });
    const proposalPath = planChangeProposalMirrorPath({
      trackerKey: "anonymous-tracker",
      id: proposalId,
    });

    expect(jobPath).toBe(
      `trackers/anonymous-tracker/ai/analysis-jobs/${jobId}.json`,
    );
    expect(proposalPath).toBe(
      `trackers/anonymous-tracker/ai/proposals/${proposalId}.json`,
    );
    expect(assertMirrorTargetPath(jobPath)).toBe(jobPath);
    expect(assertMirrorTargetPath(proposalPath)).toBe(proposalPath);
  });
});
