import "server-only";

import {
  createAiAnalysisJobAuditDocument,
  createPlanChangeProposalAuditDocument,
  type AiAnalysisJobAuditDocument,
  type PlanChangeProposalAuditDocument,
  type ProposalDecisionAudit,
  type ProposalRollbackAudit,
} from "@/domain/ai-audit";
import type { PlanChangeProposal } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import { githubSyncOutbox } from "@/server/db/schema";

import { aiAnalysisJobMirrorPath, planChangeProposalMirrorPath } from "./path";

export type AiAuditOutbox = {
  aggregateType: "ai_analysis_job" | "plan_change_proposal";
  aggregateId: string;
  targetPath: string;
  payload: Record<string, unknown>;
};

type Database = ReturnType<typeof getDatabase>;

export type AiAnalysisJobAuditSource = {
  id: string;
  trackerKey: string;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  provider: string;
  model: string;
  attemptCount: number;
  contextVersion: "1" | "2" | "3";
  contextHash: string;
  contextRevision: number;
  contextFrom: string;
  contextThrough: string;
  safetyLevel: "green" | "yellow" | "red";
  responseHash: string | null;
  lastErrorCode:
    | "not_configured"
    | "invalid_configuration"
    | "authentication"
    | "insufficient_balance"
    | "rate_limited"
    | "timeout"
    | "provider_unavailable"
    | "empty_response"
    | "truncated_response"
    | "invalid_response"
    | "unsafe_proposal"
    | "context_changed"
    | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  proposal: PlanChangeProposal | null;
};

export type PlanChangeProposalAuditSource = {
  trackerKey: string;
  analysisJobId: string;
  model: string;
  contextVersion: "1" | "2" | "3";
  contextHash: string;
  contextRevision: number;
  contextFrom: string;
  contextThrough: string;
  timelineHeadPlanVersionId: string;
  proposal: PlanChangeProposal;
};

function asPayload(
  document: AiAnalysisJobAuditDocument | PlanChangeProposalAuditDocument,
): Record<string, unknown> {
  return document;
}

export function createAiAnalysisJobAuditOutbox(
  job: AiAnalysisJobAuditSource,
  overrides: Partial<
    Pick<
      AiAnalysisJobAuditSource,
      | "status"
      | "model"
      | "attemptCount"
      | "responseHash"
      | "lastErrorCode"
      | "startedAt"
      | "completedAt"
      | "proposal"
    >
  > = {},
): AiAuditOutbox {
  const value = { ...job, ...overrides };
  const document = createAiAnalysisJobAuditDocument({
    id: value.id,
    trackerKey: value.trackerKey,
    proposalId: value.proposal?.id ?? null,
    status: value.status,
    errorCode: value.lastErrorCode,
    provider: value.provider,
    model: value.model,
    attemptCount: value.attemptCount,
    contextVersion: value.contextVersion,
    contextHash: value.contextHash,
    contextRevision: value.contextRevision,
    contextFrom: value.contextFrom,
    contextThrough: value.contextThrough,
    basePlanVersionId: value.basePlanVersionId,
    timelineHeadPlanVersionId: value.timelineHeadPlanVersionId,
    safetyLevel: value.safetyLevel,
    responseHash: value.responseHash,
    requestedAt: value.requestedAt.toISOString(),
    startedAt: value.startedAt?.toISOString() ?? null,
    completedAt: value.completedAt?.toISOString() ?? null,
  });
  return {
    aggregateType: "ai_analysis_job",
    aggregateId: document.id,
    targetPath: aiAnalysisJobMirrorPath(document),
    payload: asPayload(document),
  };
}

export function createPlanChangeProposalAuditOutbox(input: {
  source: PlanChangeProposalAuditSource;
  proposal?: PlanChangeProposal;
  decision?: ProposalDecisionAudit | null;
  rollback?: ProposalRollbackAudit | null;
}): AiAuditOutbox {
  const proposal = input.proposal ?? input.source.proposal;
  const document = createPlanChangeProposalAuditDocument({
    analysisJobId: input.source.analysisJobId,
    model: input.source.model,
    contextVersion: input.source.contextVersion,
    contextHash: input.source.contextHash,
    contextRevision: input.source.contextRevision,
    contextFrom: input.source.contextFrom,
    contextThrough: input.source.contextThrough,
    timelineHeadPlanVersionId: input.source.timelineHeadPlanVersionId,
    proposal,
    decision: input.decision ?? null,
    rollback: input.rollback ?? null,
  });
  return {
    aggregateType: "plan_change_proposal",
    aggregateId: document.id,
    targetPath: planChangeProposalMirrorPath(document),
    payload: asPayload(document),
  };
}

export function upsertAiAuditOutbox(
  database: Database,
  outbox: AiAuditOutbox,
  updatedAt: Date,
) {
  return database
    .insert(githubSyncOutbox)
    .values({
      ...outbox,
      status: "pending",
      attempts: 0,
      nextAttemptAt: updatedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [githubSyncOutbox.aggregateType, githubSyncOutbox.aggregateId],
      set: {
        targetPath: outbox.targetPath,
        payload: outbox.payload,
        status: "pending",
        attempts: 0,
        nextAttemptAt: updatedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        updatedAt,
      },
    });
}
