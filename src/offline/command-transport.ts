import "client-only";

import { z } from "zod";

import {
  PendingCommandTransportError,
  type CanonicalCommandResult,
} from "./replay";
import type { PendingCommand } from "./command-contracts";

const REQUEST_TIMEOUT_MS = 12_000;

const taskResponseSchema = z
  .object({
    commandId: z.uuid(),
    status: z.enum(["planned", "completed", "skipped"]),
    replayed: z.boolean(),
  })
  .strict();

const feedbackResponseSchema = z
  .object({
    id: z.uuid(),
    safetyLevel: z.enum(["green", "yellow", "red"]),
    replayed: z.boolean(),
    safetyPolicy: z
      .object({
        policyId: z.uuid(),
        version: z.number().int().positive(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    clientPolicyOutdated: z.boolean(),
  })
  .strict();

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
  let response: Response;
  try {
    response = await fetcher(
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
  } catch (error) {
    window.clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PendingCommandTransportError("timeout", null);
    }
    throw new PendingCommandTransportError("network_error", null);
  }

  if (!response.ok) {
    window.clearTimeout(timeout);
    throw new PendingCommandTransportError(
      safeErrorCode(response.status),
      response.status,
    );
  }

  try {
    const value: unknown = await response.json();
    if (command.kind === "task_update") {
      const parsed = taskResponseSchema.parse(value);
      if (parsed.commandId !== command.id) {
        throw new PendingCommandTransportError("invalid_response", null);
      }
      return { kind: "task_update", ...parsed };
    }

    const parsed = feedbackResponseSchema.parse(value);
    if (parsed.id !== command.id) {
      throw new PendingCommandTransportError("invalid_response", null);
    }
    return {
      kind: "symptom_check_in",
      commandId: parsed.id,
      ...parsed,
    };
  } catch (error) {
    if (error instanceof PendingCommandTransportError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PendingCommandTransportError("timeout", null);
    }
    throw new PendingCommandTransportError("invalid_response", null);
  } finally {
    window.clearTimeout(timeout);
  }
}
