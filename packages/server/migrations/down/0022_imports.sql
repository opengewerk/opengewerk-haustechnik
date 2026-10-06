-- Rolling the import from tables back to how 0021 left the database.
--
-- What it costs an installation that runs it: the list of its imports, which
-- is what the change log says about every place and asset an import made, and
-- what its lists call the asset kinds. The places and assets themselves stay.
--
-- The triggers of the log lose their condition first, so that from here on
-- every record is logged again. The rows go with the reason in the same
-- statement, so that the log of each tenant says that they went and why;
-- dropping a table writes nothing in any log.

DROP TRIGGER "audit_changes" ON "properties";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "buildings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "floors";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "floors"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "rooms";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "assets";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP FUNCTION "import_writing"();--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "asset_kind_names";--> statement-breakpoint
DROP TABLE "asset_kind_names";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "imports";--> statement-breakpoint
DROP TABLE "imports";
