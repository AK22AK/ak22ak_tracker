import "server-only";

import type { ProviderCooldown } from "../core/provider-cooldown";

export class IntegrationOperationInterruptedError extends Error {
  readonly code = "sync_in_progress" as const;
}

export class IntegrationOperationInProgressError extends IntegrationOperationInterruptedError {
  constructor() {
    super("integration_operation_in_progress");
    this.name = "IntegrationOperationInProgressError";
  }
}

export class IntegrationOperationLeaseLostError extends IntegrationOperationInterruptedError {
  constructor() {
    super("integration_operation_lease_lost");
    this.name = "IntegrationOperationLeaseLostError";
  }
}

export class IntegrationProviderCooldownError extends Error {
  readonly code = "provider_cooldown" as const;
  readonly cooldown: ProviderCooldown;

  constructor(cooldown: ProviderCooldown) {
    super("provider_cooldown");
    this.name = "IntegrationProviderCooldownError";
    this.cooldown = cooldown;
  }
}
