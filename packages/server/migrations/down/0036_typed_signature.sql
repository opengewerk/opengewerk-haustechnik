-- Rolling the typed signature back to how 0035 left the database.
--
-- What it costs an installation that runs it: every signature confirmed with
-- a typed name. 0035 knows no signature without a drawing, so they go, with
-- the reason in the log of each tenant; the activities they were given for
-- and the evidence written with them stay as they are, and the frozen state
-- of the evidence still names them. No signature can be removed while the
-- trigger keeps them, so it rests for the one statement, in the same piece.

SELECT set_config('app.reason', 'migration', true);
ALTER TABLE "activity_signatures" DISABLE TRIGGER "kept_as_written";
DELETE FROM "activity_signatures" WHERE "typed_name" IS NOT NULL;
ALTER TABLE "activity_signatures" ENABLE TRIGGER "kept_as_written";--> statement-breakpoint
ALTER TABLE "activity_signatures" DROP CONSTRAINT "activity_signatures_typed_name_shaped";--> statement-breakpoint
ALTER TABLE "activity_signatures" DROP CONSTRAINT "activity_signatures_one_way";--> statement-breakpoint
ALTER TABLE "activity_signatures" DROP COLUMN "typed_name";--> statement-breakpoint
ALTER TABLE "activity_signatures" ALTER COLUMN "path" SET NOT NULL;
