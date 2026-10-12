-- Rolling the exchange of an asset back to how 0041 left the database.
--
-- What it costs an installation that runs it: which asset took the place of
-- which. Both assets stay as they are, the old one removed in its life cycle
-- and the new one where it stood; their files no longer name each other.
--
-- The references are emptied first, with the reason in the same statement, so
-- that the log of each tenant says that they went and why. Dropping a column
-- writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
UPDATE "assets" SET "replaces_asset_id" = NULL WHERE "replaces_asset_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_not_their_own_successor";--> statement-breakpoint
DROP INDEX "assets_replaced_once";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_replace_one_of_their_property";--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "replaces_asset_id";
