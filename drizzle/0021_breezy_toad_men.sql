CREATE TABLE "assistant_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_turn_id" uuid,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_memories_category_check" CHECK ("assistant_memories"."category" IN ('goal', 'preference', 'schedule', 'equipment', 'routine', 'stable_constraint')),
	CONSTRAINT "assistant_memories_status_check" CHECK ("assistant_memories"."status" IN ('active', 'superseded', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "assistant_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tracker_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"message" text NOT NULL,
	"association" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response" jsonb,
	"provider" text,
	"model" text,
	"context_version" text,
	"context_hash" text,
	"context_revision" integer,
	"last_error_code" text,
	"confirmed_feedback_id" uuid,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_turns_status_check" CHECK ("assistant_turns"."status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "rehab_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"hash" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "rehab_profiles_status_check" CHECK ("rehab_profiles"."status" IN ('draft', 'active', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD COLUMN "source_assistant_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_source_turn_id_assistant_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."assistant_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_profiles" ADD CONSTRAINT "rehab_profiles_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_tracker_unique" ON "assistant_conversations" USING btree ("tracker_id");--> statement-breakpoint
CREATE INDEX "assistant_memories_tracker_status_index" ON "assistant_memories" USING btree ("tracker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_turns_tracker_command_unique" ON "assistant_turns" USING btree ("tracker_id","command_id");--> statement-breakpoint
CREATE INDEX "assistant_turns_conversation_created_index" ON "assistant_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rehab_profiles_tracker_version_unique" ON "rehab_profiles" USING btree ("tracker_id","version");--> statement-breakpoint
CREATE INDEX "rehab_profiles_tracker_hash_index" ON "rehab_profiles" USING btree ("tracker_id","hash");--> statement-breakpoint
CREATE INDEX "rehab_profiles_tracker_status_index" ON "rehab_profiles" USING btree ("tracker_id","status");--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_source_assistant_turn_id_assistant_turns_id_fk" FOREIGN KEY ("source_assistant_turn_id") REFERENCES "public"."assistant_turns"("id") ON DELETE set null ON UPDATE no action;