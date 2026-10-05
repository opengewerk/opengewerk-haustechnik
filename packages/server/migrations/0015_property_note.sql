-- A note at a property (opengewerk-haustechnik#85): what somebody has to know
-- before going there, the way in, where the key is, what is particular about
-- the place. The board "Neue Liegenschaft" draws it under the address.
--
-- A text the row may leave empty, trimmed and bounded when it is there, as
-- `propertyProblems` asks before anything reaches the table. Line breaks
-- inside it are kept as they were typed.
--
-- Both statements are what drizzle-kit generated from the schema. Nothing is
-- written by hand: the grants of the application role on the table are for
-- the table, the audit trigger writes every column, and the column travels
-- to a device with the row.
--
-- **Fits the version before it.** That version never names the column, and a
-- property it writes after this migration has no note.

ALTER TABLE "properties" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_note_shaped" CHECK ("properties"."note" is null or ("properties"."note" = btrim("properties"."note") and char_length("properties"."note") between 1 and 2000));
