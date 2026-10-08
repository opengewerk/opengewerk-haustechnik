-- Rolling the way an activity is performed back to how 0023 left the
-- database.
--
-- What it costs an installation that runs it: whether each activity was to be
-- performed by the own people or by a contractor. Who carries it out and the
-- name of a contractor stay.
--
-- The checks go first, so that emptying the column breaks neither. It is
-- emptied with the reason in the same statement, so that the log of each
-- tenant says that it went and why. Dropping a column writes nothing in any
-- log.

ALTER TABLE "activities" DROP CONSTRAINT "activities_performed_by_own_staff";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_contractor_named_for_a_contractor";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
UPDATE "activities" SET "performer" = NULL WHERE "performer" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "performer";
