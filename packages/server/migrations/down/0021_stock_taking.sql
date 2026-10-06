-- Rolling taking stock on site back to how 0020 left the database.
--
-- What it costs an installation that runs it: what each asset was found to be
-- distinct from when it was entered. A label that was given to an asset on
-- site stays on it; only giving another one stops.
--
-- The lists are emptied first, with the reason in the same statement, so that
-- the log of each tenant says that they went and why. Dropping a column
-- writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
UPDATE "assets" SET "distinct_from" = '{}' WHERE cardinality("distinct_from") > 0;--> statement-breakpoint
REVOKE UPDATE ("asset_id") ON "labels" FROM "opengewerk_app";--> statement-breakpoint
DROP TRIGGER "labels_given_stays" ON "labels";--> statement-breakpoint
DROP FUNCTION "keep_label_given"();--> statement-breakpoint
DROP FUNCTION "asset_duplicate_candidates"(text, text);--> statement-breakpoint
DROP POLICY "readable_by_the_owner" ON "assets";--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "distinct_from";
