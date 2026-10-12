-- Rolling the task of a deadline back to how 0039 left the database.
--
-- What it costs an installation that runs it: which task the engine made of
-- which deadline. The tasks themselves stay, with their text, their day and
-- their person; one that is open is then done by hand, because nothing marks
-- it done with the readings any more.

ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_with_a_task_of_their_property";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "task_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_place";
