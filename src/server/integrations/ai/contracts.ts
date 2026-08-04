import "server-only";

import type { AiRecoveryEvidence } from "@/domain/ai-recovery";
import type { PlanChangeOperation, PlanVersion } from "@/domain/schemas";
import type { RehabProfileDocument } from "@/domain/rehab-assistant";

export type PlanAdjustmentSafetyLevel = "green" | "yellow" | "red";

export type PlanAdjustmentFeedback = {
  localDate: string;
  timing: "morning" | "post_training" | "next_day" | "incident";
  leftPain: number;
  rightPain: number;
  swelling: "none" | "mild" | "obvious";
  stiffness: boolean;
  mechanicalSymptoms: boolean;
  weightBearingIssue: boolean;
  localizedBonePain: boolean;
  nightOrRestPain: boolean;
  safetyLevel: PlanAdjustmentSafetyLevel;
  userObservation?: string | null;
};

export type PlanAdjustmentTraining = {
  taskDefinitionId: string;
  localDate: string;
  category: string;
  durationMinutes: number | null;
  distanceKm: number | null;
};

export type PlanAdjustmentEvidenceRelation = {
  status: "confirmed_link" | "unrelated" | "observed_unconfirmed";
  taskDefinitionId: string | null;
};

export type PlanAdjustmentEvidenceOverlap = {
  status: "distinct" | "confirmed_same_session" | "possible_same_session";
  group: string | null;
};

export type PlanAdjustmentGarminEvidence = {
  provider: "garmin";
  kind: "activity";
  localDate: string;
  startedAt: string;
  activityType: string;
  durationSeconds: number;
  distanceMeters: number | null;
  averagePaceSecondsPerKilometer: number | null;
  averageHeartRateBpm: number | null;
  relation: PlanAdjustmentEvidenceRelation;
  overlap: PlanAdjustmentEvidenceOverlap;
};

export type PlanAdjustmentXunjiSet = {
  weight: number | string | null;
  unit: string | null;
  reps: number | string | null;
  duration: number | string | null;
  durationUnit: string | null;
  selfWeight: boolean | null;
  rpe: number | null;
  restSeconds: number | null;
};

export type PlanAdjustmentXunjiEvidence = {
  provider: "xunji";
  kind: "strength_training";
  localDate: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  movements: Array<{ name: string; sets: PlanAdjustmentXunjiSet[] }>;
  relation: PlanAdjustmentEvidenceRelation;
  overlap: PlanAdjustmentEvidenceOverlap;
};

export type PlanAdjustmentObservedTraining =
  PlanAdjustmentGarminEvidence | PlanAdjustmentXunjiEvidence;

export type PlanAdjustmentEvidenceCoverage = {
  localDate: string;
  garminActivity: "records" | "empty" | "failed" | "unknown";
  garminWellness: "records" | "empty" | "failed" | "unknown";
  xunjiTraining: "records" | "empty" | "failed" | "unknown";
};

export interface PlanAdjustmentContext {
  currentPlan: Pick<
    PlanVersion,
    "id" | "trackerKey" | "version" | "effectiveFrom" | "tasks" | "notes"
  >;
  timelineHeadPlanVersionId: string;
  planningTimeZone: string;
  range: { from: string; through: string };
  recentFeedback: PlanAdjustmentFeedback[];
  confirmedTraining: PlanAdjustmentTraining[];
  observedTrainingEvidence?: PlanAdjustmentObservedTraining[];
  evidenceCoverage?: PlanAdjustmentEvidenceCoverage[];
  recoveryEvidence: AiRecoveryEvidence[];
  rehabProfile?: {
    version: number;
    document: RehabProfileDocument;
  } | null;
  assistantMemories?: Array<{
    category:
      | "goal"
      | "preference"
      | "schedule"
      | "equipment"
      | "routine"
      | "stable_constraint";
    content: string;
  }>;
  sourceConversation?: {
    userMessage: string;
    assistantReply: string;
  } | null;
  safetyLevel: PlanAdjustmentSafetyLevel;
}

export type PlanAdvisorProposal = {
  summary: string;
  safetyLevel: PlanAdjustmentSafetyLevel;
  operations: PlanChangeOperation[];
  model: string;
  responseHash: string;
};

export interface PlanAdvisor {
  proposeAdjustment(
    context: PlanAdjustmentContext,
  ): Promise<PlanAdvisorProposal>;
}

// An AI adapter returns a validated proposal only. It never receives database
// or GitHub credentials and cannot apply its own proposal.
