import "server-only";

import type { AiAnalysisErrorCode } from "@/domain/ai-analysis";

export class PlanAdvisorError extends Error {
  readonly code: AiAnalysisErrorCode;

  constructor(code: AiAnalysisErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "PlanAdvisorError";
    this.code = code;
  }
}
