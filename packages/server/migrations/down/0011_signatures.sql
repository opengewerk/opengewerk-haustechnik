-- Rolling the signatures back to how 0010 left the database.
--
-- What it costs an installation that runs it: every signature and every
-- acceptance or rejection of a work order, the day an activity was performed
-- on, whether it is countersigned, and the result of each of its duties. The
-- triggers go first, so that the rows can go; the rows go with the reason in
-- the same statement, so that the log of each tenant says why they
-- disappeared.

DROP TRIGGER "kept_whole" ON "work_order_decisions";--> statement-breakpoint
DROP TRIGGER "kept_as_written" ON "work_order_decisions";--> statement-breakpoint
DROP TRIGGER "kept_whole" ON "activity_signatures";--> statement-breakpoint
DROP TRIGGER "kept_as_written" ON "activity_signatures";--> statement-breakpoint
DROP FUNCTION "kept_as_written"();--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "work_order_decisions";
DELETE FROM "activity_signatures";--> statement-breakpoint
DROP TABLE "work_order_decisions";--> statement-breakpoint
DROP TABLE "activity_signatures";--> statement-breakpoint
ALTER TABLE "activity_duties" DROP CONSTRAINT "activity_duties_not_performed_with_a_reason";--> statement-breakpoint
ALTER TABLE "activity_duties" DROP CONSTRAINT "activity_duties_result_reason_shaped";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_countersigned_but_no_work_order";--> statement-breakpoint
ALTER TABLE "activity_duties" DROP COLUMN "result_reason";--> statement-breakpoint
ALTER TABLE "activity_duties" DROP COLUMN "result";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "countersignature_required";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "performed_on";--> statement-breakpoint
DROP TYPE "public"."work_order_decision";--> statement-breakpoint
DROP TYPE "public"."signature_role";
