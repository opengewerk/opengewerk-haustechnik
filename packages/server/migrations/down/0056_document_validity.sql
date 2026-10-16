-- Rolling the validity of documents back to how 0055 left the database.
--
-- What it costs an installation that runs it: the day of every version and
-- every deadline of a document. A document of the kind "risk assessment"
-- keeps its file and loses its kind, which the type of the column no longer
-- knows.

ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "deadlines" WHERE "attachment_id" IS NOT NULL;--> statement-breakpoint
UPDATE "attachments" SET "kind" = NULL WHERE "kind" = 'risk_assessment';--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_document_of_their_property";--> statement-breakpoint
DROP INDEX "deadlines_attachment_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "attachment_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id") = 1);--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_area_key";--> statement-breakpoint
ALTER TABLE "attachment_versions" DROP COLUMN "valid_until";--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TYPE "document_kind" RENAME TO "document_kind_with_risk";--> statement-breakpoint
CREATE TYPE "document_kind" AS ENUM('operating_manual', 'test_certificate', 'circuit_diagram', 'as_built_documentation', 'permit', 'concept');--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "kind" TYPE "document_kind" USING "kind"::text::"document_kind";--> statement-breakpoint
DROP TYPE "document_kind_with_risk";
