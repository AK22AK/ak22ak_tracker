import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { githubSyncOutbox } from "@/server/db/schema";

import type {
  GitHubMirrorOutboxItem,
  GitHubMirrorOutboxStore,
} from "./consumer";
import type { GitHubMirrorErrorCode } from "./github";

type Database = ReturnType<typeof getDatabase>;

type ClaimedRow = {
  id: string;
  target_path: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export function createNeonGitHubMirrorOutboxStore(
  database: Database = getDatabase(),
): GitHubMirrorOutboxStore {
  return {
    async claimNext({ leaseOwner, now, leaseExpiresAt }) {
      const result = await database.execute<ClaimedRow>(sql`
        with candidate as (
          select current.id
          from github_sync_outbox current
          where (
            (current.status = 'pending' and current.next_attempt_at <= ${now})
            or
            (
              current.status = 'processing'
              and (current.lease_expires_at is null or current.lease_expires_at <= ${now})
            )
          )
          and not exists (
            select 1
            from github_sync_outbox blocker
            where blocker.target_path = current.target_path
              and blocker.id <> current.id
              and (
                (
                  blocker.status = 'processing'
                  and (
                    blocker.lease_expires_at is null
                    or blocker.lease_expires_at > ${now}
                    or blocker.created_at < current.created_at
                    or (blocker.created_at = current.created_at and blocker.id < current.id)
                  )
                )
                or
                (
                  blocker.status = 'pending'
                  and (
                    blocker.created_at < current.created_at
                    or (blocker.created_at = current.created_at and blocker.id < current.id)
                  )
                )
              )
          )
          order by current.created_at asc, current.id asc
          for update skip locked
          limit 1
        )
        update github_sync_outbox claimed
        set status = 'processing',
            lease_owner = ${leaseOwner},
            lease_expires_at = ${leaseExpiresAt},
            updated_at = ${now}
        from candidate
        where claimed.id = candidate.id
        returning claimed.id, claimed.target_path, claimed.payload, claimed.attempts
      `);
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        targetPath: row.target_path,
        payload: row.payload,
        attempts: row.attempts,
      } satisfies GitHubMirrorOutboxItem;
    },

    async markSucceeded(id, leaseOwner, now) {
      const rows = await database
        .update(githubSyncOutbox)
        .set({
          status: "succeeded",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(githubSyncOutbox.id, id),
            eq(githubSyncOutbox.status, "processing"),
            eq(githubSyncOutbox.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: githubSyncOutbox.id });
      return rows.length === 1;
    },

    async markRetryable(id, leaseOwner, errorCode, nextAttemptAt) {
      const rows = await database
        .update(githubSyncOutbox)
        .set({
          status: "pending",
          attempts: sql`${githubSyncOutbox.attempts} + 1`,
          nextAttemptAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncOutbox.id, id),
            eq(githubSyncOutbox.status, "processing"),
            eq(githubSyncOutbox.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: githubSyncOutbox.id });
      return rows.length === 1;
    },

    async markFailed(id, leaseOwner, errorCode) {
      const rows = await database
        .update(githubSyncOutbox)
        .set({
          status: "failed",
          attempts: sql`${githubSyncOutbox.attempts} + 1`,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncOutbox.id, id),
            eq(githubSyncOutbox.status, "processing"),
            eq(githubSyncOutbox.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: githubSyncOutbox.id });
      return rows.length === 1;
    },
  };
}

export async function getGitHubMirrorStatusProjection(
  configured: boolean,
  database: Database = getDatabase(),
  now: Date = new Date(),
) {
  const result = await database.execute<{
    pending_count: number | string;
    processing_count: number | string;
    failed_count: number | string;
    oldest_pending_at: Date | string | null;
    last_succeeded_at: Date | string | null;
    permission_error: boolean;
  }>(sql`
    select
      count(*) filter (where status = 'pending') as pending_count,
      count(*) filter (where status = 'processing') as processing_count,
      count(*) filter (where status = 'failed') as failed_count,
      min(created_at) filter (where status = 'pending') as oldest_pending_at,
      max(updated_at) filter (where status = 'succeeded') as last_succeeded_at,
      coalesce(bool_or(last_error_code in ('authentication', 'permissions', 'repository_access')) filter (where status = 'failed'), false) as permission_error
    from github_sync_outbox
  `);
  const row = result.rows[0];
  const oldest = row?.oldest_pending_at
    ? new Date(row.oldest_pending_at)
    : null;
  return {
    configuration: configured
      ? ("configured" as const)
      : ("not_configured" as const),
    pendingCount: Number(row?.pending_count ?? 0),
    processingCount: Number(row?.processing_count ?? 0),
    failedCount: Number(row?.failed_count ?? 0),
    oldestPendingAt: oldest?.toISOString() ?? null,
    lastSucceededAt: row?.last_succeeded_at
      ? new Date(row.last_succeeded_at).toISOString()
      : null,
    permissionError: Boolean(row?.permission_error),
    delayed: oldest
      ? now.getTime() - oldest.getTime() > 24 * 60 * 60 * 1_000
      : false,
  };
}

export type GitHubMirrorStoreErrorCode =
  GitHubMirrorErrorCode | "retry_exhausted";
