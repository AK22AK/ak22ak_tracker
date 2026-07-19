import "client-only";

import {
  canonicalCommandResultSchema,
  PendingCommandTransportError,
  type CanonicalCommandResult,
} from "./replay";
import type { PendingCommand } from "./command-contracts";

const REQUEST_TIMEOUT_MS = 12_000;

function safeErrorCode(status: number) {
  if (status === 401) return "authentication_required";
  if (status === 403) return "forbidden";
  if (status === 409) return "version_conflict";
  if (status === 400) return "invalid_command";
  if (status === 404) return "target_not_found";
  if (status >= 500) return "server_unavailable";
  return "request_failed";
}

export async function sendPendingCommand(
  command: PendingCommand,
  fetcher: typeof fetch = fetch,
): Promise<CanonicalCommandResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetcher(
      command.kind === "task_update"
        ? `/api/tasks/${command.payload.taskId}`
        : "/api/check-ins",
      {
        method: command.kind === "task_update" ? "PATCH" : "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body:
          command.kind === "task_update"
            ? JSON.stringify({
                commandId: command.id,
                occurredAt: command.occurredAt,
                occurredTimeZone: command.occurredTimeZone,
                occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
                status: command.payload.status,
                actual: command.payload.actual,
                note: command.payload.note,
              })
            : JSON.stringify({
                commandId: command.id,
                occurredAt: command.occurredAt,
                occurredTimeZone: command.occurredTimeZone,
                occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
                ...command.payload.checkIn,
                clientSafetyPolicy:
                  command.payload.clientSafetyPolicy ?? undefined,
              }),
      },
    );
    if (!response.ok) {
      throw new PendingCommandTransportError(
        safeErrorCode(response.status),
        response.status,
      );
    }
    const value = await response.json();
    return canonicalCommandResultSchema.parse({
      ...value,
      kind: command.kind,
      commandId: command.id,
    });
  } catch (error) {
    if (error instanceof PendingCommandTransportError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PendingCommandTransportError("timeout", null);
    }
    throw new PendingCommandTransportError("network_error", null);
  } finally {
    window.clearTimeout(timeout);
  }
}
