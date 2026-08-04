import "server-only";

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  assistantAssociationSchema,
  createAssistantTurnCommandSchema,
  type CreateAssistantTurnCommand,
} from "@/domain/rehab-assistant";
import { deepSeekCredentialRuntime } from "@/server/integrations/ai/credential-runtime";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";

import {
  loadAssistantHistoryRange,
  prepareAssistantContext,
  type PreparedAssistantContext,
} from "./context";
import { requestRehabAssistantReply } from "./deepseek";
import {
  AssistantCommandConflictError,
  createNeonAssistantStore,
} from "./repository";

type AssistantStore = ReturnType<typeof createNeonAssistantStore>;

const leaseMs = 60_000;

function safeErrorCode(error: unknown) {
  if (error instanceof PlanAdvisorError) {
    return [
      "not_configured",
      "invalid_configuration",
      "authentication",
      "insufficient_balance",
      "rate_limited",
      "timeout",
      "provider_unavailable",
      "empty_response",
      "truncated_response",
      "invalid_response",
      "context_changed",
    ].includes(error.code)
      ? error.code
      : "invalid_response";
  }
  return "provider_unavailable";
}

export function createAssistantRuntime({
  store = createNeonAssistantStore(),
  prepareContext = (input: {
    trackerKey: string;
    association: ReturnType<typeof assistantAssociationSchema.parse>;
    now: Date;
  }) => prepareAssistantContext(input),
  resolveConfiguration = (trackerKey: string) =>
    deepSeekCredentialRuntime.resolveConfiguration(trackerKey),
  requestReply = requestRehabAssistantReply,
  loadHistory = loadAssistantHistoryRange,
  now = () => new Date(),
}: {
  store?: AssistantStore;
  prepareContext?: (input: {
    trackerKey: string;
    association: ReturnType<typeof assistantAssociationSchema.parse>;
    now: Date;
  }) => Promise<PreparedAssistantContext>;
  resolveConfiguration?: typeof deepSeekCredentialRuntime.resolveConfiguration;
  requestReply?: typeof requestRehabAssistantReply;
  loadHistory?: typeof loadAssistantHistoryRange;
  now?: () => Date;
} = {}) {
  return {
    load: (trackerKey: string) => store.loadConversation(trackerKey),

    async request(trackerKey: string, raw: CreateAssistantTurnCommand) {
      const input = createAssistantTurnCommandSchema.parse(raw);
      const requestedAt = now();
      const tracker = await store.requireTracker(trackerKey);
      const existing = await store.findTurn(tracker.id, input.commandId);
      if (
        existing &&
        (existing.message !== input.message ||
          !isDeepStrictEqual(
            assistantAssociationSchema.parse(existing.association),
            input.association,
          ))
      ) {
        throw new AssistantCommandConflictError();
      }
      const turn =
        existing ??
        (await store.createTurn({
          trackerId: tracker.id,
          id: randomUUID(),
          commandId: input.commandId,
          message: input.message,
          association: input.association,
          createdAt: requestedAt,
        }));
      if (turn.status === "succeeded" || turn.status === "running") {
        return store.loadConversation(trackerKey);
      }
      const owner = randomUUID();
      const claimed = await store.claimTurn({
        trackerId: tracker.id,
        turnId: turn.id,
        owner,
        claimedAt: requestedAt,
        expiresAt: new Date(requestedAt.valueOf() + leaseMs),
      });
      if (!claimed) return store.loadConversation(trackerKey);

      try {
        const [configuration, context] = await Promise.all([
          resolveConfiguration(trackerKey),
          prepareContext({
            trackerKey,
            association: input.association,
            now: requestedAt,
          }),
        ]);
        if (configuration.status !== "configured") {
          throw new PlanAdvisorError(configuration.status);
        }
        const response = await requestReply({
          configuration: configuration.value,
          context,
          message: input.message,
          loadHistory: (range) => loadHistory(trackerKey, range),
        });
        const current = await prepareContext({
          trackerKey,
          association: input.association,
          now: requestedAt,
        });
        if (
          current.contextHash !== context.contextHash ||
          current.base.contextRevision !== context.base.contextRevision
        ) {
          throw new PlanAdvisorError("context_changed");
        }
        await store.completeTurn({
          trackerId: tracker.id,
          turnId: turn.id,
          owner,
          response,
          provider: "deepseek",
          model: configuration.value.model,
          contextVersion: context.contextVersion,
          contextHash: context.contextHash,
          contextRevision: context.base.contextRevision,
          completedAt: now(),
          memoryActions: response.memoryActions,
        });
        await deepSeekCredentialRuntime
          .recordSuccess({ trackerKey, succeededAt: now() })
          .catch(() => undefined);
      } catch (error) {
        const failedAt = now();
        const errorCode = safeErrorCode(error);
        await store.failTurn({
          trackerId: tracker.id,
          turnId: turn.id,
          owner,
          errorCode,
          completedAt: failedAt,
        });
        if (
          ["authentication", "rate_limited", "provider_unavailable"].includes(
            errorCode,
          )
        ) {
          await deepSeekCredentialRuntime
            .recordFailure({ trackerKey, errorCode, failedAt })
            .catch(() => undefined);
        }
      }
      return store.loadConversation(trackerKey);
    },
  };
}

export const assistantRuntime = {
  load(trackerKey: string) {
    return createAssistantRuntime().load(trackerKey);
  },
  request(trackerKey: string, input: CreateAssistantTurnCommand) {
    return createAssistantRuntime().request(trackerKey, input);
  },
};
