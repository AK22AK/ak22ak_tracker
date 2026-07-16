import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  ExternalRecord,
  PlanChangeProposal,
  PlanVersion,
  TrackerEvent,
} from "@/domain/schemas";

export const taskStatus = pgEnum("task_status", [
  "planned",
  "completed",
  "skipped",
]);
export const linkStatus = pgEnum("external_link_status", [
  "suggested",
  "confirmed",
  "rejected",
]);
export const syncStatus = pgEnum("sync_status", [
  "idle",
  "running",
  "succeeded",
  "failed",
]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
]);

export const trackers = pgTable("trackers", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  module: text("module").notNull(),
  startedOn: date("started_on").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const planVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    document: jsonb("document").$type<PlanVersion>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("plan_versions_tracker_version_unique").on(
      table.trackerId,
      table.version,
    ),
  ],
);

export const taskInstances = pgTable(
  "task_instances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id, { onDelete: "restrict" }),
    taskDefinitionId: text("task_definition_id").notNull(),
    scheduledOn: date("scheduled_on").notNull(),
    status: taskStatus("status").default("planned").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    confirmedByUser: boolean("confirmed_by_user").default(false).notNull(),
    subjectiveNote: text("subjective_note"),
  },
  (table) => [
    index("task_instances_tracker_date_index").on(
      table.trackerId,
      table.scheduledOn,
    ),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    localDate: date("local_date").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    document: jsonb("document").$type<TrackerEvent>().notNull(),
  },
  (table) => [
    uniqueIndex("events_idempotency_key_unique").on(table.idempotencyKey),
    index("events_tracker_date_index").on(table.trackerId, table.localDate),
  ],
);

export const externalRecords = pgTable(
  "external_records",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerRecordId: text("provider_record_id").notNull(),
    kind: text("kind").notNull(),
    localDate: date("local_date").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    document: jsonb("document").$type<ExternalRecord>().notNull(),
  },
  (table) => [
    uniqueIndex("external_records_provider_id_unique").on(
      table.provider,
      table.providerRecordId,
    ),
    index("external_records_tracker_date_index").on(
      table.trackerId,
      table.localDate,
    ),
  ],
);

export const externalRecordLinks = pgTable(
  "external_record_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalRecordId: uuid("external_record_id")
      .notNull()
      .references(() => externalRecords.id, { onDelete: "cascade" }),
    taskInstanceId: uuid("task_instance_id")
      .notNull()
      .references(() => taskInstances.id, { onDelete: "cascade" }),
    status: linkStatus("status").default("suggested").notNull(),
    confidence: integer("confidence"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("external_record_links_pair_unique").on(
      table.externalRecordId,
      table.taskInstanceId,
    ),
  ],
);

export const planChangeProposals = pgTable("plan_change_proposals", {
  id: uuid("id").primaryKey(),
  trackerId: uuid("tracker_id")
    .notNull()
    .references(() => trackers.id, { onDelete: "cascade" }),
  basePlanVersionId: uuid("base_plan_version_id")
    .notNull()
    .references(() => planVersions.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  safetyLevel: text("safety_level").notNull(),
  document: jsonb("document").$type<PlanChangeProposal>().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  appliedPlanVersionId: uuid("applied_plan_version_id").references(
    () => planVersions.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const integrationSyncState = pgTable(
  "integration_sync_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: syncStatus("status").default("idle").notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_sync_state_tracker_provider_unique").on(
      table.trackerId,
      table.provider,
    ),
  ],
);

export const githubSyncOutbox = pgTable(
  "github_sync_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    targetPath: text("target_path").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_sync_outbox_aggregate_unique").on(
      table.aggregateType,
      table.aggregateId,
    ),
    index("github_sync_outbox_status_retry_index").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);
