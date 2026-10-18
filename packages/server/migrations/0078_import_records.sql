-- What each import made (#174): a row of `import_records` for every
-- property, building, floor, room and asset an import wrote, so that the page
-- of an import leads to them and the log of each begins with the import.
--
-- A trigger on the five tables writes the row, on the same condition under
-- which their log writes nothing since 0022: while `import_writing()` is true,
-- inside the transaction that wrote the row of its import. So every record an
-- import makes gets its row and nothing else does, whichever route imports,
-- and the version before this one writes them as well. The function runs as
-- whoever imports; the policy of the tenant holds it to the tenant.
--
-- The table does not travel (decided on 15.10.2026) and has no columns of the
-- sync. The application role reads and inserts and no more; a row is never
-- changed, and goes with its tenant. It is outside the log of the tenant: it
-- is written only while the five tables log nothing, and the row of the
-- import is the entry.
--
-- An import from before this migration made records that have no row; its
-- page says nothing of them.
CREATE TABLE "import_records" (
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	CONSTRAINT "import_records_pkey" PRIMARY KEY("tenant_id","table_name","record_id"),
	CONSTRAINT "import_records_table_known" CHECK ("table_name" in ('properties', 'buildings', 'floors', 'rooms', 'assets'))
);
--> statement-breakpoint
ALTER TABLE "import_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_of_an_import" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_records_by_import" ON "import_records" USING btree ("tenant_id","import_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_records" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("import_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("import_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "import_records" TO "opengewerk_app";--> statement-breakpoint
CREATE FUNCTION "import_record"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	INSERT INTO public.import_records (tenant_id, import_id, table_name, record_id)
	VALUES (new.tenant_id, nullif(current_setting('app.import_id', true), '')::uuid, tg_table_name, new.id);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "imported_by" AFTER INSERT ON "properties"
	FOR EACH ROW WHEN (public.import_writing()) EXECUTE FUNCTION "import_record"();--> statement-breakpoint
CREATE TRIGGER "imported_by" AFTER INSERT ON "buildings"
	FOR EACH ROW WHEN (public.import_writing()) EXECUTE FUNCTION "import_record"();--> statement-breakpoint
CREATE TRIGGER "imported_by" AFTER INSERT ON "floors"
	FOR EACH ROW WHEN (public.import_writing()) EXECUTE FUNCTION "import_record"();--> statement-breakpoint
CREATE TRIGGER "imported_by" AFTER INSERT ON "rooms"
	FOR EACH ROW WHEN (public.import_writing()) EXECUTE FUNCTION "import_record"();--> statement-breakpoint
CREATE TRIGGER "imported_by" AFTER INSERT ON "assets"
	FOR EACH ROW WHEN (public.import_writing()) EXECUTE FUNCTION "import_record"();
