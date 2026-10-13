-- Rolling the taken-over readings back to how 0047 left the database.
--
-- What it costs an installation that runs it: a reading taken over from a
-- list stands as entered by hand from then on, beside the name of whoever
-- imported the list; and the entry of each import of the history of meters
-- and of templates of rounds goes, for which 0047 has no kind, with the
-- reason in the log of each tenant. The readings, the replacements, the
-- periods of rest and the templates themselves stay.
--
-- PostgreSQL does not take a value out of an enum, so the type is made anew
-- without it. The column is rewritten by the statement that changes its
-- type; no reading is changed by a statement of its own, which the table
-- would refuse.

ALTER TABLE "meter_readings" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."meter_reading_source";--> statement-breakpoint
CREATE TYPE "public"."meter_reading_source" AS ENUM('by_hand', 'reading_round', 'round', 'protocol');--> statement-breakpoint
ALTER TABLE "meter_readings" ALTER COLUMN "source" SET DATA TYPE "public"."meter_reading_source" USING (CASE WHEN "source" = 'taken_over' THEN 'by_hand' ELSE "source" END)::"public"."meter_reading_source";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "imports" WHERE "kind" in ('meters', 'templates');--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_kind_known";--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_kind_known" CHECK ("kind" in ('structure', 'assets', 'deadlines'));
