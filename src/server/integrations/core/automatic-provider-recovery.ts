import "server-only";

export type AutomaticProviderRecoveryClaimResult =
  | { status: "claimed"; priorLastSucceededAt: Date | null }
  | "not_due"
  | "in_progress";

export type AutomaticProviderRecoveryClaimStore = {
  claim(input: {
    trackerId: string;
    provider: string;
    attemptedAt: Date;
    minimumIntervalMs: number;
    leaseMs: number;
  }): Promise<AutomaticProviderRecoveryClaimResult>;
};

export async function runAutomaticProviderRecovery<Result>(input: {
  trackerId: string;
  provider: string;
  now: Date;
  minimumIntervalMs: number;
  leaseMs: number;
  store: AutomaticProviderRecoveryClaimStore;
  recover: (priorLastSucceededAt: Date | null) => Promise<Result>;
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
  if (typeof claim === "string") {
    return { status: "skipped", reason: claim };
  }
  return {
    status: "completed",
    result: await input.recover(claim.priorLastSucceededAt),
  };
}
