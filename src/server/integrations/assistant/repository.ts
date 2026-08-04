import "server-only";

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";

import {
  assistantAssociationSchema,
  assistantConversationDtoSchema,
  assistantMemoryCategorySchema,
  assistantTurnResponseSchema,
  rehabProfileDocumentSchema,
  type AssistantAssociation,
  type AssistantMemoryAction,
  type AssistantTurnResponse,
  type RehabProfileDocument,
} from "@/domain/rehab-assistant";
import { getDatabase } from "@/server/db/client";
import {
  assistantConversations,
  assistantMemories,
  assistantTurns,
  rehabProfiles,
  trackers,
} from "@/server/db/schema";
import { contentHash } from "@/server/integrations/core/content-hash";

export class AssistantTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "AssistantTrackerNotFoundError";
  }
}

export class AssistantCommandConflictError extends Error {
  constructor() {
    super("assistant_command_conflict");
    this.name = "AssistantCommandConflictError";
  }
}

export function createNeonAssistantStore(database = getDatabase()) {
  async function requireTracker(trackerKey: string) {
    const [tracker] = await database
      .select({
        id: trackers.id,
        key: trackers.key,
        planningTimeZone: trackers.planningTimeZone,
        aiContextRevision: trackers.aiContextRevision,
      })
      .from(trackers)
      .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
      .limit(1);
    if (!tracker) throw new AssistantTrackerNotFoundError();
    return tracker;
  }

  async function loadTurn(trackerId: string, idOrCommandId: string) {
    const [row] = await database
      .select()
      .from(assistantTurns)
      .where(
        and(
          eq(assistantTurns.trackerId, trackerId),
          or(
            eq(assistantTurns.id, idOrCommandId),
            eq(assistantTurns.commandId, idOrCommandId),
          ),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  return {
    requireTracker,

    async loadConversation(trackerKey: string) {
      const tracker = await requireTracker(trackerKey);
      const [conversationRows, turnRows, memoryRows, profileRows] =
        await Promise.all([
          database
            .select({ id: assistantConversations.id })
            .from(assistantConversations)
            .where(eq(assistantConversations.trackerId, tracker.id))
            .limit(1),
          database
            .select()
            .from(assistantTurns)
            .where(eq(assistantTurns.trackerId, tracker.id))
            .orderBy(desc(assistantTurns.createdAt))
            .limit(100),
          database
            .select()
            .from(assistantMemories)
            .where(eq(assistantMemories.trackerId, tracker.id))
            .orderBy(asc(assistantMemories.createdAt)),
          database
            .select()
            .from(rehabProfiles)
            .where(eq(rehabProfiles.trackerId, tracker.id))
            .orderBy(desc(rehabProfiles.version))
            .limit(1),
        ]);
      return assistantConversationDtoSchema.parse({
        schemaVersion: "1.0.0",
        conversationId: conversationRows[0]?.id ?? null,
        turns: turnRows.reverse().map((turn) => ({
          id: turn.id,
          commandId: turn.commandId,
          message: turn.message,
          association: assistantAssociationSchema.parse(turn.association),
          status: turn.status,
          response: turn.response
            ? assistantTurnResponseSchema.parse(turn.response)
            : null,
          errorCode: turn.lastErrorCode,
          model: turn.model,
          contextHash: turn.contextHash,
          confirmedFeedbackId: turn.confirmedFeedbackId,
          createdAt: turn.createdAt.toISOString(),
          completedAt: turn.completedAt?.toISOString() ?? null,
        })),
        memories: memoryRows.map((memory) => ({
          id: memory.id,
          category: memory.category,
          content: memory.content,
          status: memory.status,
          createdAt: memory.createdAt.toISOString(),
          updatedAt: memory.updatedAt.toISOString(),
        })),
        profile: profileRows[0]
          ? {
              id: profileRows[0].id,
              version: profileRows[0].version,
              status: profileRows[0].status,
              document: rehabProfileDocumentSchema.parse(
                profileRows[0].document,
              ),
              createdAt: profileRows[0].createdAt.toISOString(),
              activatedAt: profileRows[0].activatedAt?.toISOString() ?? null,
            }
          : null,
        nextCursor: null,
      });
    },

    async createTurn(input: {
      trackerId: string;
      id: string;
      commandId: string;
      message: string;
      association: AssistantAssociation;
      createdAt: Date;
    }) {
      await database.execute(sql`
        with conversation as (
          insert into assistant_conversations (id, tracker_id, created_at, updated_at)
          values (${randomUUID()}::uuid, ${input.trackerId}::uuid, ${input.createdAt}, ${input.createdAt})
          on conflict (tracker_id) do update set updated_at = excluded.updated_at
          returning id
        )
        insert into assistant_turns (
          id, conversation_id, tracker_id, command_id, message, association,
          status, created_at, updated_at
        )
        select ${input.id}::uuid, conversation.id, ${input.trackerId}::uuid,
          ${input.commandId}::uuid, ${input.message},
          ${JSON.stringify(assistantAssociationSchema.parse(input.association))}::jsonb,
          'pending', ${input.createdAt}, ${input.createdAt}
        from conversation
        on conflict (tracker_id, command_id) do nothing
      `);
      const turn = await loadTurn(input.trackerId, input.commandId);
      if (
        !turn ||
        turn.message !== input.message ||
        !isDeepStrictEqual(
          assistantAssociationSchema.parse(turn.association),
          assistantAssociationSchema.parse(input.association),
        )
      ) {
        throw new AssistantCommandConflictError();
      }
      return turn;
    },

    async findTurn(trackerId: string, idOrCommandId: string) {
      return loadTurn(trackerId, idOrCommandId);
    },

    async claimTurn(input: {
      trackerId: string;
      turnId: string;
      owner: string;
      claimedAt: Date;
      expiresAt: Date;
    }) {
      const result = await database
        .update(assistantTurns)
        .set({
          status: "running",
          leaseOwner: input.owner,
          leaseExpiresAt: input.expiresAt,
          startedAt: input.claimedAt,
          lastErrorCode: null,
          updatedAt: input.claimedAt,
        })
        .where(
          and(
            eq(assistantTurns.id, input.turnId),
            eq(assistantTurns.trackerId, input.trackerId),
            or(
              eq(assistantTurns.status, "pending"),
              eq(assistantTurns.status, "failed"),
              and(
                eq(assistantTurns.status, "running"),
                lt(assistantTurns.leaseExpiresAt, input.claimedAt),
              ),
            ),
          ),
        )
        .returning({ id: assistantTurns.id });
      return result.length === 1;
    },

    async completeTurn(input: {
      trackerId: string;
      turnId: string;
      owner: string;
      response: AssistantTurnResponse;
      provider: string;
      model: string;
      contextVersion: string;
      contextHash: string;
      contextRevision: number;
      completedAt: Date;
      memoryActions: AssistantMemoryAction[];
    }) {
      const response = assistantTurnResponseSchema.parse(input.response);
      const memoryActions = input.memoryActions.map((action) => ({
        ...action,
        id: randomUUID(),
        category: assistantMemoryCategorySchema.parse(action.category),
      }));
      await database.execute(sql`
        with completed as (
          update assistant_turns
          set status = 'succeeded',
              response = ${JSON.stringify(response)}::jsonb,
              provider = ${input.provider},
              model = ${input.model},
              context_version = ${input.contextVersion},
              context_hash = ${input.contextHash},
              context_revision = ${input.contextRevision},
              last_error_code = null,
              lease_owner = null,
              lease_expires_at = null,
              completed_at = ${input.completedAt},
              updated_at = ${input.completedAt}
          where id = ${input.turnId}::uuid
            and tracker_id = ${input.trackerId}::uuid
            and status = 'running'
            and lease_owner = ${input.owner}::uuid
          returning id, tracker_id
        ), actions as (
          select action.*
          from completed
          cross join jsonb_to_recordset(${JSON.stringify(memoryActions)}::jsonb)
            as action(id uuid, type text, category text, content text)
        ), remembered as (
          insert into assistant_memories (
            id, tracker_id, category, content, status, source_turn_id,
            created_at, updated_at
          )
          select actions.id, completed.tracker_id, actions.category,
            actions.content, 'active', completed.id,
            ${input.completedAt}, ${input.completedAt}
          from actions
          cross join completed
          where actions.type = 'remember'
          returning id
        ), forgotten as (
          update assistant_memories memory
          set status = 'superseded', updated_at = ${input.completedAt}
          from actions, completed
          where actions.type = 'forget'
            and memory.tracker_id = completed.tracker_id
            and memory.category = actions.category
            and memory.content = actions.content
            and memory.status = 'active'
          returning memory.id
        ), revised as (
          update trackers tracker
          set ai_context_revision = tracker.ai_context_revision + 1,
              updated_at = ${input.completedAt}
          from completed
          where tracker.id = completed.tracker_id
          returning tracker.id
        )
        select
          (select count(*) from completed) as completed_count,
          (select count(*) from remembered) as remembered_count,
          (select count(*) from forgotten) as forgotten_count,
          (select count(*) from revised) as revised_count
      `);
      return loadTurn(input.trackerId, input.turnId);
    },

    async failTurn(input: {
      trackerId: string;
      turnId: string;
      owner: string;
      errorCode: string;
      completedAt: Date;
    }) {
      await database
        .update(assistantTurns)
        .set({
          status: "failed",
          lastErrorCode: input.errorCode,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(
          and(
            eq(assistantTurns.id, input.turnId),
            eq(assistantTurns.trackerId, input.trackerId),
            eq(assistantTurns.leaseOwner, input.owner),
          ),
        );
    },

    async saveActiveProfile(input: {
      trackerId: string;
      document: RehabProfileDocument;
      now: Date;
    }) {
      const document = rehabProfileDocumentSchema.parse(input.document);
      const id = randomUUID();
      const hash = contentHash(document);
      const [active] = await database
        .select({ id: rehabProfiles.id, hash: rehabProfiles.hash })
        .from(rehabProfiles)
        .where(
          and(
            eq(rehabProfiles.trackerId, input.trackerId),
            eq(rehabProfiles.status, "active"),
          ),
        )
        .orderBy(desc(rehabProfiles.version))
        .limit(1);
      if (active?.hash === hash) return active.id;
      await database.execute(sql`
        with tracker_guard as (
          select id from trackers where id = ${input.trackerId}::uuid for update
        ), next_version as (
          select coalesce(max(version), 0) + 1 as version
          from rehab_profiles where tracker_id = ${input.trackerId}::uuid
        ), superseded as (
          update rehab_profiles set status = 'superseded'
          where tracker_id = ${input.trackerId}::uuid and status = 'active'
        ), inserted as (
          insert into rehab_profiles (
            id, tracker_id, version, status, hash, document, created_at, activated_at
          )
          select ${id}::uuid, tracker_guard.id, next_version.version, 'active',
            ${hash}, ${JSON.stringify(document)}::jsonb, ${input.now}, ${input.now}
          from tracker_guard cross join next_version
          returning id
        )
        update trackers set ai_context_revision = ai_context_revision + 1,
          updated_at = ${input.now}
        where id in (select id from tracker_guard) and exists (select 1 from inserted)
      `);
      return id;
    },

    async updateMemory(input: {
      trackerId: string;
      memoryId: string;
      category: string;
      content: string;
      now: Date;
    }) {
      const category = assistantMemoryCategorySchema.parse(input.category);
      const [updatedRows] = await database.batch([
        database
          .update(assistantMemories)
          .set({ category, content: input.content, updatedAt: input.now })
          .where(
            and(
              eq(assistantMemories.id, input.memoryId),
              eq(assistantMemories.trackerId, input.trackerId),
              eq(assistantMemories.status, "active"),
            ),
          )
          .returning({ id: assistantMemories.id }),
        database
          .update(trackers)
          .set({
            aiContextRevision: sql`${trackers.aiContextRevision} + 1`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(trackers.id, input.trackerId),
              sql`exists (
                select 1 from ${assistantMemories}
                where ${assistantMemories.id} = ${input.memoryId}::uuid
                  and ${assistantMemories.trackerId} = ${input.trackerId}::uuid
                  and ${assistantMemories.status} = 'active'
              )`,
            ),
          ),
      ]);
      if (!updatedRows[0]) throw new Error("memory_not_found");
    },

    async deleteMemory(input: {
      trackerId: string;
      memoryId: string;
      now: Date;
    }) {
      const [updatedRows] = await database.batch([
        database
          .update(assistantMemories)
          .set({ status: "deleted", updatedAt: input.now })
          .where(
            and(
              eq(assistantMemories.id, input.memoryId),
              eq(assistantMemories.trackerId, input.trackerId),
              eq(assistantMemories.status, "active"),
            ),
          )
          .returning({ id: assistantMemories.id }),
        database
          .update(trackers)
          .set({
            aiContextRevision: sql`${trackers.aiContextRevision} + 1`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(trackers.id, input.trackerId),
              sql`exists (
                select 1 from ${assistantMemories}
                where ${assistantMemories.id} = ${input.memoryId}::uuid
                  and ${assistantMemories.trackerId} = ${input.trackerId}::uuid
                  and ${assistantMemories.status} = 'deleted'
              )`,
            ),
          ),
      ]);
      if (!updatedRows[0]) throw new Error("memory_not_found");
    },
  };
}

export function getAssistantStore() {
  return createNeonAssistantStore();
}
