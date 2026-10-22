-- Takes back 0107_replaced_duty: a duty no longer names the duty it took the place of. The duty that ended stays ended.
ALTER TABLE "duties" DROP CONSTRAINT "duties_replaced_by_the_catalogue";--> statement-breakpoint
DROP INDEX "duties_replaced_once";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_replace_one_at_their_asset";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_asset_key";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "replaces_duty_id";
