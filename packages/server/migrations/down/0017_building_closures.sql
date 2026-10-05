-- Rolling the closures back to how 0016 left the database.
--
-- What it costs an installation that runs it: every time a building is
-- closed. The rows go first, with the reason in the same statement, so that
-- the log of each tenant says why they disappeared; dropping a table writes
-- nothing in any log. The trigger on the buildings goes with its function.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "building_closures";--> statement-breakpoint
DROP TRIGGER "closures_follow_deletion" ON "buildings";--> statement-breakpoint
DROP FUNCTION "mark_closures_below"();--> statement-breakpoint
DROP TABLE "building_closures";
