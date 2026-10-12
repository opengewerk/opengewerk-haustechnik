-- Rolling what a duty keeps of a new version back to how 0040 left the
-- database.
--
-- What it costs an installation that runs it: the guide each duty was
-- confirmed with, and every decision to leave a duty as it is against a new
-- version, with its reason. The duties stay as they are; one that was left
-- as it is is then reported again, and a guide that was corrected in its
-- record is no longer noticed. Who decided and when stays in the log of
-- changes.

ALTER TABLE "duties" DROP CONSTRAINT "duties_kept_reason_shaped";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_kept_in_bounds";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_kept_one_unit";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_kept_version_shaped";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_kept_from_the_catalogue";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_kept_whole";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_maximum_or_guide";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_guide_in_bounds";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_guide_one_unit";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "kept_reason";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "kept_months";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "kept_days";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "kept_version";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "guide_months";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "guide_days";
