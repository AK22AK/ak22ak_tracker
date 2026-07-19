CREATE TABLE "execution_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_pauses_end_check" CHECK ("execution_pauses"."ended_on" IS NULL OR "execution_pauses"."ended_on" >= "execution_pauses"."started_on")
);
--> statement-breakpoint
ALTER TABLE "execution_pauses" ADD CONSTRAINT "execution_pauses_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_pauses_one_active_per_tracker_unique" ON "execution_pauses" USING btree ("tracker_id") WHERE "execution_pauses"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "execution_pauses_tracker_started_index" ON "execution_pauses" USING btree ("tracker_id","started_on");