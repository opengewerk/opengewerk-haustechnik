-- The import of places and assets from tables (#100, sections 3 and 11 of
-- the concept).
--
-- `imports` holds one row for every import: the file, how many of its lines
-- were read and what came of them. The row is written in the transaction that
-- writes the records of the import and is never changed, so the application
-- role may insert and read, and no more.
--
-- That row is what the change log shows of an import: "ein Import ist ein
-- Eintrag im Änderungsprotokoll" (section 11). The triggers that write the
-- log for properties, buildings, floors, rooms and assets get a condition for
-- it: while `import_writing()` is true they write nothing. It is true only
-- inside a transaction that has named an import (`app.import_id`) whose row
-- that same transaction wrote, in the tenant of the transaction. So nothing
-- is written past the log without the row that stands for it being written
-- with it, and a later transaction cannot use the row of an old import to
-- write quietly: `xmin` is the transaction a row was written by. A
-- transaction that writes behind a savepoint is not that transaction, and
-- then every record is logged as always; the condition fails on the side of
-- more log, never of less.
--
-- The rows still travel. `stamp_sync_columns` has no condition, so a device
-- hears of every room and asset an import made, with the next pull.
--
-- `asset_kind_names` is what the lists of a tenant call the asset kinds: a
-- word and the key of the kind it means, once per word as the import compares
-- words (`name_key`). Kept by whoever imports assets, read by every later
-- import, changed by saving the word again. Neither table has an area: an
-- import reaches as far as the person importing, and a word means the same
-- kind everywhere.
--
-- Everything from the tables down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** Both tables are new, and the function is
-- false for every transaction of a server that does not know it, so the log
-- of such a server is written as before.
CREATE TABLE "asset_kind_names" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_kind_names_name_shaped" CHECK ("asset_kind_names"."name" = btrim("asset_kind_names"."name") and char_length("asset_kind_names"."name") between 1 and 120),
	CONSTRAINT "asset_kind_names_key_shaped" CHECK (char_length("asset_kind_names"."name_key") between 1 and 120),
	CONSTRAINT "asset_kind_names_kind_shaped" CHECK ("asset_kind_names"."kind" = btrim("asset_kind_names"."kind") and char_length("asset_kind_names"."kind") between 1 and 130)
);
--> statement-breakpoint
ALTER TABLE "asset_kind_names" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"lines" integer NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imports_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "imports_kind_known" CHECK ("kind" in ('structure', 'assets')),
	CONSTRAINT "imports_file_name_shaped" CHECK ("imports"."file_name" = btrim("imports"."file_name") and char_length("imports"."file_name") between 1 and 200),
	CONSTRAINT "imports_summary_shaped" CHECK ("imports"."summary" = btrim("imports"."summary") and char_length("imports"."summary") between 1 and 500),
	CONSTRAINT "imports_lines_counted" CHECK ("imports"."lines" > 0)
);
--> statement-breakpoint
ALTER TABLE "imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_kind_names" ADD CONSTRAINT "asset_kind_names_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_kind_names_once" ON "asset_kind_names" USING btree ("tenant_id","name_key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "asset_kind_names" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("asset_kind_names"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("asset_kind_names"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "imports" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("imports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("imports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "asset_kind_names" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_kind_names" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "imports" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "asset_kind_names"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "imports"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- Whether this transaction writes the records of an import whose row it has
-- written itself. Asked by the triggers below for every row, as the role that
-- writes: it reads `imports` under the policy of the tenant, and needs no
-- right of its own. A setting that names nothing, or was never set, is no
-- import.
CREATE FUNCTION "import_writing"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1
		  FROM public.imports i
		 WHERE i.id = nullif(current_setting('app.import_id', true), '')::uuid
		   AND i.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
		   AND i.xmin = pg_current_xact_id()::xid
	)
$$;--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "properties";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "properties"
	FOR EACH ROW WHEN (NOT public.import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "buildings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "buildings"
	FOR EACH ROW WHEN (NOT public.import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "floors";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "floors"
	FOR EACH ROW WHEN (NOT public.import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "rooms";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "rooms"
	FOR EACH ROW WHEN (NOT public.import_writing()) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "assets";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "assets"
	FOR EACH ROW WHEN (NOT public.import_writing()) EXECUTE FUNCTION "record_change"();
