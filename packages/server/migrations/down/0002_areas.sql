-- Rolling the areas back to how 0001 left the database.
--
-- What it costs an installation that runs it: the areas of every tenant, who
-- sees which, and who stands in for whom. Nothing else hangs on them yet.
--
-- The rows go first, with the reason in the same statement, so that the log of
-- each tenant says why its areas disappeared. Dropping a table writes nothing
-- in any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "substitutions";
DELETE FROM "member_areas";
DELETE FROM "member_all_areas";
DELETE FROM "areas";--> statement-breakpoint
DROP TRIGGER "default_areas" ON "memberships";--> statement-breakpoint
DROP FUNCTION "membership_gets_default_areas"();--> statement-breakpoint
DROP FUNCTION "grant_default_areas"(uuid, text);--> statement-breakpoint
DROP FUNCTION "session_areas"();--> statement-breakpoint
DROP FUNCTION "session_sees_all_areas"();--> statement-breakpoint
DROP TABLE "substitutions";--> statement-breakpoint
DROP TABLE "member_areas";--> statement-breakpoint
DROP TABLE "member_all_areas";--> statement-breakpoint
DROP TABLE "areas";
