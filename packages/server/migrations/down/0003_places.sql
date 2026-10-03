-- Rolling the place back to how 0002 left the database.
--
-- What it costs an installation that runs it: every property, building, floor
-- and room. Nothing else hangs on them yet.
--
-- The rows go first, with the reason in the same statement, so that the log of
-- each tenant says why its places disappeared, from the rooms up, as the keys
-- ask. Dropping a table writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "rooms";
DELETE FROM "floors";
DELETE FROM "buildings";
DELETE FROM "properties";--> statement-breakpoint
DROP TABLE "rooms";--> statement-breakpoint
DROP TABLE "floors";--> statement-breakpoint
DROP TABLE "buildings";--> statement-breakpoint
DROP TABLE "properties";--> statement-breakpoint
DROP FUNCTION "mark_places_below"();--> statement-breakpoint
DROP FUNCTION "each_once"(anyarray);--> statement-breakpoint
DROP TYPE "public"."building_kind";--> statement-breakpoint
DROP TYPE "public"."federal_state";
