import "server-only";

import type {
  PlanChangeProposal,
  PlanVersion,
  TrackerEvent,
} from "@/domain/schemas";

export interface PlanAdjustmentContext {
  currentPlan: PlanVersion;
  recentEvents: TrackerEvent[];
  immutableSafetyRules: string[];
}

export interface PlanAdvisor {
  proposeAdjustment(
    context: PlanAdjustmentContext,
  ): Promise<PlanChangeProposal>;
}

// An AI adapter returns a validated proposal only. It never receives database
// or GitHub credentials and cannot apply its own proposal.
