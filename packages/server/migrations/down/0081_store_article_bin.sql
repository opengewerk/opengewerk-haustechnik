-- Takes the place of an article in a store out again, back to how 0080 left
-- things. Run as the superuser, like every rollback.
ALTER TABLE "store_articles" DROP CONSTRAINT IF EXISTS "store_articles_bin_fits";--> statement-breakpoint
ALTER TABLE "store_articles" DROP COLUMN IF EXISTS "bin";
