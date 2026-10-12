-- The task the deadline engine made of a deadline (#242, section 2.4 of the
-- concept): the action "Aufgabe" gives whoever answers for the reading of the
-- meters of a property something to do by the key date. The deadline names
-- that task, so that it has one at a time: when its due day comes again or
-- moves, the engine finds the task it made and makes no second one beside an
-- open one, and it marks the task done once the deadline no longer waits for
-- its day.
--
-- The key runs over the tenant and the property, like every key to a row
-- with a place (ADR 0003): a deadline cannot name a task of another operator
-- or of another property. For it the tasks get the key over the three
-- columns that the other rows with a place have. No source writes the column,
-- and so no pass of the engine takes it away. A task is marked and never
-- deleted (0039), so the key holds nothing back.
--
-- The three statements are what drizzle-kit generated from the schema, in
-- another order: the key of the tasks has to stand before the one that
-- points at it.
--
-- **Fits the version before it.** That version never asks the column and
-- writes no value into it: its deadlines keep an empty one.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_place" UNIQUE("tenant_id","id","property_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_with_a_task_of_their_property" FOREIGN KEY ("tenant_id","task_id","property_id") REFERENCES "public"."tasks"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
