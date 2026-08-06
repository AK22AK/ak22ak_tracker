export const providerCooldownDefaultMs = 30_000;

export type ProviderCooldownKind = "normal" | "rate_limited";

export type ProviderCooldown = {
  kind: ProviderCooldownKind;
  retryAvailableAt: Date;
  retryAfterMs: number;
  serverNow: Date;
};

export type ProviderCooldownClaim =
  | { status: "claimed"; cooldown: ProviderCooldown }
  | { status: "cooldown"; cooldown: ProviderCooldown };

export type ProviderCooldownTimestamp = Date | string;

function normalizeProviderCooldownTimestamp(
  value: unknown,
  field: "retry_available_at" | "server_now",
): Date {
  const normalized =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string" && value.trim() !== ""
        ? new Date(value)
        : null;
  if (!normalized || !Number.isFinite(normalized.getTime())) {
    throw new Error(`provider_cooldown_${field}_invalid`);
  }
  return normalized;
}

export function cooldownFromDeadline(input: {
  kind: ProviderCooldownKind;
  retryAvailableAt: ProviderCooldownTimestamp;
  serverNow: ProviderCooldownTimestamp;
}): ProviderCooldown {
  const retryAvailableAt = normalizeProviderCooldownTimestamp(
    input.retryAvailableAt,
    "retry_available_at",
  );
  const serverNow = normalizeProviderCooldownTimestamp(
    input.serverNow,
    "server_now",
  );
  return {
    kind: input.kind,
    retryAvailableAt,
    serverNow,
    retryAfterMs: Math.max(0, retryAvailableAt.getTime() - serverNow.getTime()),
  };
}

export function canonicalCooldownDeadline(input: {
  now: ProviderCooldownTimestamp;
  providerRetryAfterMs?: number | null;
}) {
  const providerRetryAfterMs = input.providerRetryAfterMs ?? 0;
  if (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs < 0) {
    throw new Error("provider_cooldown_retry_after_invalid");
  }
  const now = normalizeProviderCooldownTimestamp(input.now, "server_now");
  const deadline = new Date(
    now.getTime() + Math.max(providerCooldownDefaultMs, providerRetryAfterMs),
  );
  if (!Number.isFinite(deadline.getTime())) {
    throw new Error("provider_cooldown_retry_available_at_invalid");
  }
  return deadline;
}
