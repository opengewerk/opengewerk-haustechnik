-- Rolling the tasks back to how 0038 left the database.
--
-- What it costs an installation that runs it: every task, open and done. The
-- places, assets and activities they hung on stay as they are. Dropping a
-- table writes nothing in any log.

DROP TRIGGER "tasks_follow_deletion" ON "properties";--> statement-breakpoint
DROP TRIGGER "tasks_follow_deletion" ON "buildings";--> statement-breakpoint
DROP TRIGGER "tasks_follow_deletion" ON "rooms";--> statement-breakpoint
DROP TRIGGER "tasks_follow_deletion" ON "assets";--> statement-breakpoint
DROP TRIGGER "tasks_follow_deletion" ON "activities";--> statement-breakpoint
DROP FUNCTION "mark_tasks_below"();--> statement-breakpoint
DROP TABLE "tasks";--> statement-breakpoint
DROP FUNCTION "record_task_author"();--> statement-breakpoint
DROP TYPE "task_status";
