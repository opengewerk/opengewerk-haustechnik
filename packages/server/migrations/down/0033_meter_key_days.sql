-- Rolling the key days of the meters back to how 0032 left the database.
--
-- What it costs an installation that runs it: the day of the month the
-- operator set for its readings, the days of the measuring points, which
-- figures were confirmed although they jumped, and the deadlines of the
-- meters, which the engine of the older version does not know. A reading for
-- a key date other than the first of a month cannot stay under the rule of
-- 0032; the trigger of 0032 refuses to remove one, so the rollback stops at
-- the check if there is one.

DELETE FROM "deadlines" WHERE "meter_property_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_meters_of_their_property";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "meter_property_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id") = 1);--> statement-breakpoint
ALTER TABLE "meter_readings" DROP CONSTRAINT "meter_readings_key_day_in_month";--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_on_a_key_date" CHECK (extract(day from "meter_readings"."key_date") = 1);--> statement-breakpoint
ALTER TABLE "meter_readings" DROP COLUMN "jump_confirmed";--> statement-breakpoint
ALTER TABLE "meter_points" DROP CONSTRAINT "meter_points_key_day_in_month";--> statement-breakpoint
ALTER TABLE "meter_points" DROP COLUMN "key_day";--> statement-breakpoint
DROP TABLE "meter_settings";
