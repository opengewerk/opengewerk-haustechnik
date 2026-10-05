-- Rolling the note of a property back to how 0014 left the table.
--
-- What it costs an installation that runs it: the notes at its properties.
--
-- The notes are emptied first, with the reason in the same statement, so that
-- the log of each tenant says that they went and why. Dropping a column
-- writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
UPDATE "properties" SET "note" = NULL WHERE "note" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" DROP CONSTRAINT "properties_note_shaped";--> statement-breakpoint
ALTER TABLE "properties" DROP COLUMN "note";
