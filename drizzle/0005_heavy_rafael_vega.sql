CREATE TABLE "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"algorithm" text NOT NULL,
	"key_version" integer NOT NULL,
	"nonce" text NOT NULL,
	"ciphertext" text NOT NULL,
	"auth_tag" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_date_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"local_date" date NOT NULL,
	"status" "sync_status" DEFAULT 'idle' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"cached_until" timestamp with time zone,
	"record_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "external_records_provider_id_unique";--> statement-breakpoint
ALTER TABLE "external_record_links" ADD COLUMN "source_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_record_links" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "external_records" ADD COLUMN "content_hash" text;--> statement-breakpoint
UPDATE "external_records"
SET
	"content_hash" = repeat(md5("document"::text), 2),
	"document" = jsonb_set(
		jsonb_set(
			"document",
			'{contentHash}',
			to_jsonb(repeat(md5("document"::text), 2))
		),
		'{sourceVersion}',
		'1'::jsonb
	);--> statement-breakpoint
ALTER TABLE "external_records" ALTER COLUMN "content_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "external_records" ADD COLUMN "source_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "external_records" ADD COLUMN "source_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_date_sync_state" ADD CONSTRAINT "integration_date_sync_state_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_tracker_provider_unique" ON "integration_credentials" USING btree ("tracker_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_date_sync_tracker_provider_date_unique" ON "integration_date_sync_state" USING btree ("tracker_id","provider","local_date");--> statement-breakpoint
CREATE INDEX "integration_date_sync_status_index" ON "integration_date_sync_state" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_records_provider_id_unique" ON "external_records" USING btree ("tracker_id","provider","provider_record_id");
