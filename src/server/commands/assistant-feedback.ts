import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { trackerEventSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import { trackers } from "@/server/db/schema";

import type { AssistantFeedbackCommandStore } from "./assistant-feedback-core";

type Database = ReturnType<typeof getDatabase>;

type ConfirmationRow = {
  canonical_document: Record<string, unknown> | null;
  command_document: Record<string, unknown> | null;
  created: boolean;
};

export function createNeonAssistantFeedbackCommandStore(
  database: Database = getDatabase(),
): AssistantFeedbackCommandStore {
  return {
    async findTracker(key) {
      const [tracker] = await database
        .select({
          id: trackers.id,
          key: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
        })
        .from(trackers)
        .where(and(eq(trackers.key, key), eq(trackers.active, true)))
        .limit(1);
      return tracker ?? null;
    },

    async confirmAtomically(command) {
      const result = await database.execute<ConfirmationRow>(sql`
        with turn_guard as materialized (
          select turn.id, turn.tracker_id, turn.confirmed_feedback_id
          from assistant_turns turn
          where turn.id = ${command.turnId}::uuid
            and turn.tracker_id = ${command.trackerId}::uuid
            and turn.status = 'succeeded'
            and turn.response -> 'feedbackDraft' is not null
            and turn.response -> 'feedbackDraft' <> 'null'::jsonb
          for update
        ), inserted_event as (
          insert into events (
            id, tracker_id, kind, local_date, occurred_at, recorded_at,
            occurred_time_zone, occurred_utc_offset_minutes,
            idempotency_key, document
          )
          select
            ${command.event.id}::uuid,
            turn_guard.tracker_id,
            ${command.event.kind},
            ${command.event.localDate}::date,
            ${command.event.occurredAt}::timestamptz,
            ${command.event.recordedAt}::timestamptz,
            ${command.event.occurredTimeZone},
            ${command.event.occurredUtcOffsetMinutes},
            ${command.event.idempotencyKey},
            ${JSON.stringify(command.event)}::jsonb
          from turn_guard
          where turn_guard.confirmed_feedback_id is null
          on conflict do nothing
          returning id, document
        ), inserted_outbox as (
          insert into github_sync_outbox (
            aggregate_type, aggregate_id, target_path, payload
          )
          select
            ${command.outbox.aggregateType},
            inserted_event.id,
            ${command.outbox.targetPath},
            ${JSON.stringify(command.outbox.payload)}::jsonb
          from inserted_event
          returning aggregate_id
        ), pointed as (
          update assistant_turns turn
          set confirmed_feedback_id = inserted_event.id,
              updated_at = ${command.updatedAt}
          from inserted_event
          where turn.id = ${command.turnId}::uuid
            and turn.tracker_id = ${command.trackerId}::uuid
            and turn.confirmed_feedback_id is null
            and exists (
              select 1 from inserted_outbox
              where inserted_outbox.aggregate_id = inserted_event.id
            )
          returning turn.confirmed_feedback_id
        )
        select
          coalesce(
            (
              select existing.document
              from events existing
              where existing.id = turn_guard.confirmed_feedback_id
            ),
            (select inserted_event.document from inserted_event)
          ) as canonical_document,
          coalesce(
            (select inserted_event.document from inserted_event),
            (
              select existing.document
              from events existing
              where existing.idempotency_key = ${command.event.idempotencyKey}
              limit 1
            )
          ) as command_document,
          exists(select 1 from pointed) as created
        from turn_guard
      `);
      const row = result.rows[0];
      return {
        canonicalEvent: row?.canonical_document
          ? trackerEventSchema.parse(row.canonical_document)
          : null,
        commandEvent: row?.command_document
          ? trackerEventSchema.parse(row.command_document)
          : null,
        created: row?.created ?? false,
      };
    },
  };
}
