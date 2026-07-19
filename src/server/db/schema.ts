import {
  boolean,
  check,
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
import { sql } from "drizzle-orm";

import type {
  ExecutionAlternativeDocument,
  ExecutionDayConditions,
  executionPauseReasonSchema,
} from "@/domain/execution-context";
import type { z } from "zod";
import type {
  ExternalRecord,
  PlanChangeProposal,
  PlanVersion,
  TaskActual,
  TrackerEvent,
} from "@/domain/schemas";
import type { ResumptionAssessmentSnapshot } from "@/domain/resumption";
import type { TrackerSafetyPolicyDocument } from "@/domain/safety-policy";

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
export const executionContextKind = pgEnum("execution_context_kind", [
  "travel",
  "equipment_limited",
]);
export const executionSafetyDisposition = pgEnum(
  "execution_safety_disposition",
  ["normal", "stop_reassess"],
);
type ExecutionPauseReason = z.infer<typeof executionPauseReasonSchema>;

export const trackers = pgTable("trackers", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  module: text("module").notNull(),
  startedOn: date("started_on").notNull(),
  planningTimeZone: text("planning_time_zone")
    .default("Asia/Shanghai")
    .notNull(),
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
    index("plan_versions_tracker_effective_index").on(
      table.trackerId,
      table.effectiveFrom,
    ),
  ],
);

export const trackerSafetyPolicies = pgTable(
  "tracker_safety_policies",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    hash: text("hash").notNull(),
    document: jsonb("document").$type<TrackerSafetyPolicyDocument>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("tracker_safety_policies_tracker_version_unique").on(
      table.trackerId,
      table.version,
    ),
    uniqueIndex("tracker_safety_policies_tracker_hash_unique").on(
      table.trackerId,
      table.hash,
    ),
    index("tracker_safety_policies_tracker_effective_index").on(
      table.trackerId,
      table.effectiveFrom,
    ),
  ],
);

export const executionContexts = pgTable(
  "execution_contexts",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    kind: executionContextKind("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    endedOn: date("ended_on"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "execution_contexts_date_range_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    index("execution_contexts_tracker_range_index").on(
      table.trackerId,
      table.startDate,
      table.endDate,
    ),
    // Migration 0007 adds a btree_gist exclusion constraint so open date
    // ranges cannot overlap. Drizzle does not model EXCLUDE constraints.
  ],
);

export const executionAlternativeVersions = pgTable(
  "execution_alternative_versions",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    optionKey: text("option_key").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    document: jsonb("document").$type<ExecutionAlternativeDocument>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("execution_alternatives_tracker_key_version_unique").on(
      table.trackerId,
      table.optionKey,
      table.version,
    ),
    index("execution_alternatives_tracker_effective_index").on(
      table.trackerId,
      table.effectiveFrom,
    ),
  ],
);

export const executionDayDecisions = pgTable(
  "execution_day_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    contextId: uuid("context_id")
      .notNull()
      .references(() => executionContexts.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    conditions: jsonb("conditions").$type<ExecutionDayConditions>().notNull(),
    selectedAlternativeId: uuid("selected_alternative_id").references(
      () => executionAlternativeVersions.id,
      { onDelete: "restrict" },
    ),
    selectedAlternativeVersion: integer("selected_alternative_version"),
    safetyDisposition: executionSafetyDisposition("safety_disposition")
      .default("normal")
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("execution_day_decisions_context_date_unique").on(
      table.contextId,
      table.localDate,
    ),
    check(
      "execution_day_decisions_selection_check",
      sql`(${table.selectedAlternativeId} IS NULL AND ${table.selectedAlternativeVersion} IS NULL) OR (${table.selectedAlternativeId} IS NOT NULL AND ${table.selectedAlternativeVersion} IS NOT NULL)`,
    ),
    index("execution_day_decisions_tracker_date_index").on(
      table.trackerId,
      table.localDate,
    ),
  ],
);

export const executionPauses = pgTable(
  "execution_pauses",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    reason: text("reason").$type<ExecutionPauseReason>().notNull(),
    note: text("note"),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("execution_pauses_one_active_per_tracker_unique")
      .on(table.trackerId)
      .where(sql`${table.endedAt} IS NULL`),
    index("execution_pauses_tracker_started_index").on(
      table.trackerId,
      table.startedOn,
    ),
    check(
      "execution_pauses_end_check",
      sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`,
    ),
  ],
);

export const resumptionAssessments = pgTable(
  "resumption_assessments",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    triggerId: uuid("trigger_id").notNull(),
    basePlanVersionId: uuid("base_plan_version_id")
      .notNull()
      .references(() => planVersions.id, { onDelete: "restrict" }),
    timelineHeadPlanVersionId: uuid("timeline_head_plan_version_id")
      .notNull()
      .references(() => planVersions.id, { onDelete: "restrict" }),
    planningTimeZone: text("planning_time_zone").notNull(),
    status: text("status").default("pending").notNull(),
    snapshot: jsonb("snapshot").$type<ResumptionAssessmentSnapshot>().notNull(),
    decision: text("decision"),
    appliedPlanVersionId: uuid("applied_plan_version_id").references(
      () => planVersions.id,
      { onDelete: "restrict" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("resumption_assessments_trigger_unique").on(
      table.trackerId,
      table.triggerType,
      table.triggerId,
      table.basePlanVersionId,
      table.timelineHeadPlanVersionId,
    ),
    index("resumption_assessments_tracker_status_index").on(
      table.trackerId,
      table.status,
    ),
    check(
      "resumption_assessments_trigger_type_check",
      sql`${table.triggerType} IN ('execution_context', 'pause')`,
    ),
    check(
      "resumption_assessments_status_check",
      sql`${table.status} IN ('pending', 'kept_original', 'shifted', 'expired')`,
    ),
    check(
      "resumption_assessments_decision_check",
      sql`${table.decision} IS NULL OR ${table.decision} IN ('keep_original', 'shift')`,
    ),
  ],
);

export const resumptionDecisions = pgTable(
  "resumption_decisions",
  {
    id: uuid("id").primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => resumptionAssessments.id, { onDelete: "restrict" }),
    basePlanVersionId: uuid("base_plan_version_id")
      .notNull()
      .references(() => planVersions.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    appliedPlanVersionId: uuid("applied_plan_version_id").references(
      () => planVersions.id,
      { onDelete: "restrict" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("resumption_decisions_assessment_unique").on(
      table.assessmentId,
    ),
    index("resumption_decisions_tracker_index").on(table.trackerId),
    check(
      "resumption_decisions_decision_check",
      sql`${table.decision} IN ('keep_original', 'shift')`,
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
    actualData: jsonb("actual_data").$type<TaskActual>(),
    subjectiveNote: text("subjective_note"),
  },
  (table) => [
    uniqueIndex("task_instances_plan_task_unique").on(
      table.planVersionId,
      table.taskDefinitionId,
    ),
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
    occurredTimeZone: text("occurred_time_zone")
      .default("Asia/Shanghai")
      .notNull(),
    occurredUtcOffsetMinutes: integer("occurred_utc_offset_minutes")
      .default(480)
      .notNull(),
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
    contentHash: text("content_hash").notNull(),
    sourceVersion: integer("source_version").default(1).notNull(),
    sourceChangedAt: timestamp("source_changed_at", { withTimezone: true }),
    document: jsonb("document").$type<ExternalRecord>().notNull(),
  },
  (table) => [
    uniqueIndex("external_records_provider_id_unique").on(
      table.trackerId,
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
    taskInstanceId: uuid("task_instance_id").references(
      () => taskInstances.id,
      { onDelete: "cascade" },
    ),
    status: linkStatus("status").default("suggested").notNull(),
    confidence: integer("confidence"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    sourceVersion: integer("source_version").default(1).notNull(),
    needsReview: boolean("needs_review").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("external_record_links_record_unique").on(
      table.externalRecordId,
    ),
    check(
      "external_record_links_target_check",
      sql`(${table.status} = 'rejected' AND ${table.taskInstanceId} IS NULL) OR (${table.status} <> 'rejected' AND ${table.taskInstanceId} IS NOT NULL)`,
    ),
  ],
);

export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    algorithm: text("algorithm").notNull(),
    keyVersion: integer("key_version").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    authTag: text("auth_tag").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_credentials_tracker_provider_unique").on(
      table.trackerId,
      table.provider,
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

export const integrationDateSyncState = pgTable(
  "integration_date_sync_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackerId: uuid("tracker_id")
      .notNull()
      .references(() => trackers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    localDate: date("local_date").notNull(),
    status: syncStatus("status").default("idle").notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    cachedUntil: timestamp("cached_until", { withTimezone: true }),
    recordCount: integer("record_count").default(0).notNull(),
    contentHash: text("content_hash"),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_date_sync_tracker_provider_date_unique").on(
      table.trackerId,
      table.provider,
      table.localDate,
    ),
    index("integration_date_sync_status_index").on(
      table.status,
      table.updatedAt,
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
