-- Rolling the plans of the rounds back to how 0029 left the database.
--
-- What it costs an installation that runs it: every plan, and the deadlines
-- of the plans. The rounds a plan made stay, as rounds without a plan; the
-- check over the source of a deadline holds again for the duties and the
-- defects alone. The rows go first, with the reason in the same statement,
-- so that the log of each tenant says why they disappeared; dropping a table
-- writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "deadlines" WHERE "round_plan_id" IS NOT NULL;--> statement-breakpoint
UPDATE "activities" SET "round_plan_id" = NULL WHERE "round_plan_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "round_plans";--> statement-breakpoint
DROP TRIGGER "plans_follow_deletion" ON "buildings";--> statement-breakpoint
DROP TRIGGER "plans_follow_deletion" ON "properties";--> statement-breakpoint
DROP FUNCTION "mark_plans_below"();--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_plan_of_their_property";--> statement-breakpoint
DROP INDEX "deadlines_round_plan_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "round_plan_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id") = 1);--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_plan_makes_rounds";--> statement-breakpoint
DROP INDEX "activities_once_per_pass";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_of_a_plan_of_their_property";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "round_plan_id";--> statement-breakpoint
DROP TABLE "round_plans";--> statement-breakpoint
DROP TYPE "public"."round_plan_rhythm";
