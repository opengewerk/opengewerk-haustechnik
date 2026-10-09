-- Rolling the readings of the measuring points back to how 0031 left the database.
--
-- What it costs an installation that runs it: every reading, every
-- replacement of a meter, every period a measuring point rests, and what only
-- a measuring point carries, its factor, its main meter, its id in the
-- building management system, its note and its lock. The assets stay, with
-- their meter numbers. A reading is written once, and its trigger refuses to
-- delete one, so the tables go as they are; dropping a table writes nothing in
-- any log.

DROP TABLE "meter_readings";--> statement-breakpoint
DROP FUNCTION "reading_kept_as_written"();--> statement-breakpoint
DROP TABLE "meter_exchanges";--> statement-breakpoint
DROP TABLE "meter_pauses";--> statement-breakpoint
DROP TABLE "meter_points";--> statement-breakpoint
DROP TYPE "public"."meter_reading_source";
