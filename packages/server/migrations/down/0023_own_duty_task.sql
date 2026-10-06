-- Rolling the task of a duty of the operator's own back to how 0022 left the
-- database.
--
-- What it costs an installation that runs it: what each duty of the
-- operator's own was said to have somebody do. The duties themselves stay,
-- with their name, their basis and their source.
--
-- The tasks are emptied first, with the reason in the same statement, so that
-- the log of each tenant says that they went and why. Dropping a column
-- writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
UPDATE "duties" SET "task" = NULL WHERE "task" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_task_of_their_own";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "task";--> statement-breakpoint
DROP TYPE "public"."duty_task";
