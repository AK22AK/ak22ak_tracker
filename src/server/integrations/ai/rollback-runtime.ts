import "server-only";

import {
  planVersionRollbackResultSchema,
  type PlanVersionRollbackCommand,
} from "@/domain/ai-analysis";
import { schemaVersion } from "@/domain/schemas";
import { createNeonPlanVersionRollbackStore } from "@/server/commands/plan-version-rollback";
import {
  executePlanVersionRollback,
  type PlanVersionRollbackStore,
} from "@/server/commands/plan-version-rollback-core";

import { aiAnalysisRuntime } from "./runtime";

export function createPlanVersionRollbackRuntime({
  store = createNeonPlanVersionRollbackStore(),
  loadPage = (trackerKey: string, proposalId: string) =>
    aiAnalysisRuntime.load(trackerKey, proposalId),
  now = () => new Date(),
}: {
  store?: PlanVersionRollbackStore;
  loadPage?: typeof aiAnalysisRuntime.load;
  now?: () => Date;
} = {}) {
  return {
    async rollback(input: PlanVersionRollbackCommand & { trackerKey: string }) {
      const result = await executePlanVersionRollback(store, input, now());
      return planVersionRollbackResultSchema.parse({
        schemaVersion,
        ...result,
        page: await loadPage(input.trackerKey, input.proposalId),
      });
    },
  };
}

export const planVersionRollbackRuntime = {
  rollback(input: PlanVersionRollbackCommand & { trackerKey: string }) {
    return createPlanVersionRollbackRuntime().rollback(input);
  },
};
