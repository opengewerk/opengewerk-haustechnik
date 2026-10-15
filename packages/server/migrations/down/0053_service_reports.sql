-- Rolling the service reports back to how 0052 left the database.
--
-- What it costs an installation that runs it: every client's signature under
-- a service report, the frozen states and the record of which PDF was made of
-- which of them, and whether the operator had names and times switched on.
-- The PDFs stay in the store as files of their tenant. The triggers refuse to
-- empty the tables, so they go as they are; the prints of a service report go
-- first, since the older checks of `prints` do not know them.

ALTER TABLE "prints" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" DISABLE TRIGGER "kept_as_written";--> statement-breakpoint
DELETE FROM "prints" WHERE "service_report_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "prints" ENABLE TRIGGER "kept_as_written";--> statement-breakpoint
ALTER TABLE "prints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_of_one_record";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_voided_evidence";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_follow_their_service_report";--> statement-breakpoint
DROP INDEX "prints_of_a_service_report_once";--> statement-breakpoint
ALTER TABLE "prints" DROP COLUMN "service_report_id";--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_one_record" CHECK (num_nonnulls("prints"."evidence_id", "prints"."activity_id") = 1);--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_voided_evidence" CHECK (not "prints"."voided" or "prints"."evidence_id" is not null);--> statement-breakpoint
DROP TABLE "service_report_records";--> statement-breakpoint
DROP TABLE "service_reports";--> statement-breakpoint
DROP TABLE "work_order_settings";--> statement-breakpoint
DROP FUNCTION "service_report_kept_as_written"();
