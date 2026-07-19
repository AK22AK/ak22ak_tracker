DROP INDEX "external_record_links_pair_unique";--> statement-breakpoint
ALTER TABLE "external_record_links" ALTER COLUMN "task_instance_id" DROP NOT NULL;--> statement-breakpoint
WITH "ranked_links" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "external_record_id"
			ORDER BY
				CASE "status"
					WHEN 'confirmed' THEN 0
					WHEN 'suggested' THEN 1
					ELSE 2
				END,
				"confirmed_at" DESC NULLS LAST,
				"id"
		) AS "position"
	FROM "external_record_links"
)
DELETE FROM "external_record_links"
USING "ranked_links"
WHERE
	"external_record_links"."id" = "ranked_links"."id"
	AND "ranked_links"."position" > 1;--> statement-breakpoint
UPDATE "external_record_links"
SET "task_instance_id" = NULL
WHERE "status" = 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX "external_record_links_record_unique" ON "external_record_links" USING btree ("external_record_id");--> statement-breakpoint
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_target_check" CHECK (("external_record_links"."status" = 'rejected' AND "external_record_links"."task_instance_id" IS NULL) OR ("external_record_links"."status" <> 'rejected' AND "external_record_links"."task_instance_id" IS NOT NULL));
