-- Rolling the duties back to how 0006 left the database.
--
-- What it costs an installation that runs it: every duty and every dismissal,
-- with the decisions they hold. The rows go first, with the reason in the same
-- statement, so that the log of each tenant says why they disappeared;
-- dropping a table writes nothing in any log. The triggers on the place and
-- the assets go with their function.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "duty_dismissals";
DELETE FROM "duties";--> statement-breakpoint
DROP TRIGGER "duties_follow_deletion" ON "assets";--> statement-breakpoint
DROP TRIGGER "duties_follow_deletion" ON "rooms";--> statement-breakpoint
DROP TRIGGER "duties_follow_deletion" ON "buildings";--> statement-breakpoint
DROP TRIGGER "duties_follow_deletion" ON "properties";--> statement-breakpoint
DROP FUNCTION "mark_duties_below"();--> statement-breakpoint
DROP TABLE "duty_dismissals";--> statement-breakpoint
DROP TABLE "duties";--> statement-breakpoint
DROP TYPE "public"."duty_performer";--> statement-breakpoint
DROP TYPE "public"."duty_counting";--> statement-breakpoint
DROP TYPE "public"."duty_basis";
