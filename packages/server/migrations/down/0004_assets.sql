-- Rolling the technology back to how 0003 left the database.
--
-- What it costs an installation that runs it: every asset and component,
-- every entry of a life cycle and every supply. Nothing else hangs on them
-- yet.
--
-- The rows go first, with the reason in the same statement, so that the log of
-- each tenant says why its assets disappeared: the supplies and the life cycle
-- before the assets they belong to, the assets in one statement, which the key
-- between a component and its asset checks at its end. Dropping a table writes
-- nothing in any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "asset_supplies";
DELETE FROM "asset_lifecycle";
DELETE FROM "assets";--> statement-breakpoint
DROP TRIGGER "assets_below_follow_deletion" ON "buildings";--> statement-breakpoint
DROP TRIGGER "assets_below_follow_deletion" ON "rooms";--> statement-breakpoint
DROP TABLE "asset_supplies";--> statement-breakpoint
DROP TABLE "asset_lifecycle";--> statement-breakpoint
DROP TABLE "assets";--> statement-breakpoint
DROP FUNCTION "mark_assets_below"();--> statement-breakpoint
DROP FUNCTION "asset_stays_on_its_property"();--> statement-breakpoint
DROP FUNCTION "asset_hangs_not_under_itself"();--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_in_their_building";--> statement-breakpoint
DROP TYPE "public"."meter_unit";--> statement-breakpoint
DROP TYPE "public"."lifecycle_state";
