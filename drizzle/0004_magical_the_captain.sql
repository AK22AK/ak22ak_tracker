CREATE TABLE "tracker_safety_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"hash" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracker_safety_policies" ADD CONSTRAINT "tracker_safety_policies_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_safety_policies_tracker_version_unique" ON "tracker_safety_policies" USING btree ("tracker_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_safety_policies_tracker_hash_unique" ON "tracker_safety_policies" USING btree ("tracker_id","hash");--> statement-breakpoint
CREATE INDEX "tracker_safety_policies_tracker_effective_index" ON "tracker_safety_policies" USING btree ("tracker_id","effective_from");