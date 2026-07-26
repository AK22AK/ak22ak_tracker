import "server-only";

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
