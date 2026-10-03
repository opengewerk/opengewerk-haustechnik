-- Rolling the activities and defects back to how 0008 left the database.
--
-- What it costs an installation that runs it: every activity with its duties
-- and its work order, and every defect. The rows go first, with the reason in
-- the same statement, so that the log of each tenant says why they
-- disappeared; dropping a table writes nothing in any log. The triggers on the
-- place, the assets, the activities and the duties go with their function.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "defects";
DELETE FROM "work_orders";
DELETE FROM "activity_duties";
DELETE FROM "activities";--> statement-breakpoint
DROP TRIGGER "activities_follow_deletion" ON "duties";--> statement-breakpoint
DROP TRIGGER "activities_follow_deletion" ON "activities";--> statement-breakpoint
DROP TRIGGER "activities_follow_deletion" ON "assets";--> statement-breakpoint
DROP TRIGGER "activities_follow_deletion" ON "rooms";--> statement-breakpoint
DROP TRIGGER "activities_follow_deletion" ON "buildings";--> statement-breakpoint
DROP TRIGGER "activities_follow_deletion" ON "properties";--> statement-breakpoint
DROP FUNCTION "mark_activities_below"();--> statement-breakpoint
DROP TABLE "defects";--> statement-breakpoint
DROP TABLE "work_orders";--> statement-breakpoint
DROP TABLE "activity_duties";--> statement-breakpoint
DROP TABLE "activities";--> statement-breakpoint
DROP TYPE "public"."defect_status";--> statement-breakpoint
DROP TYPE "public"."work_order_kind";--> statement-breakpoint
DROP TYPE "public"."activity_status";--> statement-breakpoint
DROP TYPE "public"."activity_kind";
