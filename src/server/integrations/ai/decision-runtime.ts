import "server-only";

import {
  planChangeDecisionResultSchema,
  type PlanChangeDecisionCommand,
} from "@/domain/ai-analysis";
import { schemaVersion } from "@/domain/schemas";
import { createNeonPlanChangeDecisionStore } from "@/server/commands/plan-change-decision";
import {
  executePlanChangeDecision,
  type PlanChangeDecisionStore,
} from "@/server/commands/plan-change-decision-core";

import {
  prepareAiAnalysisContext,
  type PreparedAiAnalysisContext,
} from "./context";
import { aiAnalysisRuntime } from "./runtime";

export function createPlanChangeDecisionRuntime({
  store = createNeonPlanChangeDecisionStore(),
  prepareContext = (trackerKey: string, now: Date) =>
    prepareAiAnalysisContext({ trackerKey, now }),
  loadPage = (trackerKey: string, jobId: string) =>
    aiAnalysisRuntime.load(trackerKey, jobId),
  now = () => new Date(),
}: {
  store?: PlanChangeDecisionStore;
  prepareContext?: (
    trackerKey: string,
    now: Date,
  ) => Promise<PreparedAiAnalysisContext>;
  loadPage?: typeof aiAnalysisRuntime.load;
  now?: () => Date;
} = {}) {
  return {
    async decide(input: PlanChangeDecisionCommand & { trackerKey: string }) {
      const result = await executePlanChangeDecision(
        store,
        prepareContext,
        input,
        now(),
      );
      return planChangeDecisionResultSchema.parse({
        schemaVersion,
        ...result,
        page: await loadPage(input.trackerKey, input.proposalId),
      });
    },
  };
}

export const planChangeDecisionRuntime = {
  decide(input: PlanChangeDecisionCommand & { trackerKey: string }) {
    return createPlanChangeDecisionRuntime().decide(input);
  },
};
