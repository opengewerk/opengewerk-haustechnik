-- Rolling the basic measures back to how 0057 left the database.
--
-- What it costs an installation that runs it: the basic measure every work
-- order of another kind chose. Every other one follows from its kind again
-- once the column is back.

ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_measure_of_another_kind";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "measure";--> statement-breakpoint
DROP TYPE "basic_measure";
