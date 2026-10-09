-- Rolling what is said with a result and the template of a protocol back to
-- how 0027 left the database.
--
-- What it costs an installation that runs it: what was said with the result
-- of each duty of an activity that is not written down yet, and the day of
-- the protocol an activity took as its template. The answers it took stay.
-- An evidence keeps the remark in its frozen state.
--
-- The check goes first. Both columns are emptied with the reason in the same
-- statement, so that the log of each tenant says that they went and why.
-- Dropping a column writes nothing in any log.

ALTER TABLE "activity_duties" DROP CONSTRAINT "activity_duties_remark_shaped";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
UPDATE "activity_duties" SET "remark" = NULL WHERE "remark" IS NOT NULL;
UPDATE "activities" SET "template_on" = NULL WHERE "template_on" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_duties" DROP COLUMN "remark";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "template_on";
