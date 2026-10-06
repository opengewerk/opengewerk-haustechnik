-- What a duty of the operator's own has somebody do (#103, sections 2.3 and
-- 4.3 of the concept).
--
-- A duty kind of the catalogue says whether it is a test, a maintenance or one
-- of the four other tasks. A duty of the operator's own had nothing to say it
-- with, and the activity that is made from a due appointment has to know. It
-- names its task from the same list; one from the catalogue names none and
-- takes it from its kind, like its name, its basis and its source.
--
-- The route asks a new duty of the operator's own for its task. The database
-- does not: a duty entered before this column has none, and no migration
-- knows what somebody meant.
CREATE TYPE "public"."duty_task" AS ENUM('inspection', 'maintenance', 'condition_assessment', 'function_check', 'visual_check', 'sampling');--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "task" "duty_task";--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_task_of_their_own" CHECK ("duties"."kind" is null or "duties"."task" is null);
