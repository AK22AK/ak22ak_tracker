import "server-only";

import type { IntegrationProvider } from "./external-records";

export type AutomaticProviderRecoveryClaimResult =
  "claimed" | "not_due" | "in_progress";

export type AutomaticProviderRecoveryClaimStore = {
  claim(input: {
    trackerId: string;
    provider: IntegrationProvider;
    attemptedAt: Date;
    minimumIntervalMs: number;
    leaseMs: number;
  }): Promise<AutomaticProviderRecoveryClaimResult>;
};

export async function runAutomaticProviderRecovery<Result>(input: {
  trackerId: string;
  provider: IntegrationProvider;
  now: Date;
  minimumIntervalMs: number;
  leaseMs: number;
  store: AutomaticProviderRecoveryClaimStore;
  recover: () => Promise<Result>;
}): Promise<
  | { status: "skipped"; reason: "not_due" | "in_progress" }
  | { status: "completed"; result: Result }
> {
  const claim = await input.store.claim({
    trackerId: input.trackerId,
    provider: input.provider,
    attemptedAt: input.now,
    minimumIntervalMs: input.minimumIntervalMs,
    leaseMs: input.leaseMs,
  });
  if (claim !== "claimed") {
    return { status: "skipped", reason: claim };
  }
  return { status: "completed", result: await input.recover() };
}
