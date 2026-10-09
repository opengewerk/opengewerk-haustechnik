-- Rolling the notes on the work orders back to how 0030 left the database.
--
-- What it costs an installation that runs it: every note on a work order,
-- and the time spent on each order. The orders stay, with their activities
-- and their signatures. A note is written once, and its trigger refuses to
-- delete one, so the table goes as it is; dropping a table or a column writes
-- nothing in any log.

DROP TABLE "work_order_notes";--> statement-breakpoint
DROP FUNCTION "note_kept_as_written"();--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_duration_shaped";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "duration_minutes";
