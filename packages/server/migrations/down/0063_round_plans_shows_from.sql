-- Rolling the day a round shows from back to how 0062 left the database.
--
-- What it costs an installation that runs it: the day each weekly, monthly
-- and yearly plan shows its rounds from. The version before reads its rounds
-- by the lead again, which is 0 for every plan this version wrote.

ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_shows_from";--> statement-breakpoint
ALTER TABLE "round_plans" DROP COLUMN "shows_from_month";--> statement-breakpoint
ALTER TABLE "round_plans" DROP COLUMN "shows_from_day";
