-- Takes the records of the imports out again, back to how 0077 left things:
-- an import is one entry in the log and names no record. The places and
-- assets stay. Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "imported_by" ON "properties";--> statement-breakpoint
DROP TRIGGER IF EXISTS "imported_by" ON "buildings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "imported_by" ON "floors";--> statement-breakpoint
DROP TRIGGER IF EXISTS "imported_by" ON "rooms";--> statement-breakpoint
DROP TRIGGER IF EXISTS "imported_by" ON "assets";--> statement-breakpoint
DROP FUNCTION IF EXISTS "import_record"();--> statement-breakpoint
DROP TABLE IF EXISTS "import_records";
