-- Takes the names of what an import made out again, back to how 0079 left
-- things: the trigger writes the row of a record without them, as in 0078.
-- Run as the superuser, like every rollback.
CREATE OR REPLACE FUNCTION "import_record"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	INSERT INTO public.import_records (tenant_id, import_id, table_name, record_id)
	VALUES (new.tenant_id, nullif(current_setting('app.import_id', true), '')::uuid, tg_table_name, new.id);

	RETURN NULL;
END;
$$;--> statement-breakpoint
ALTER TABLE "import_records" DROP CONSTRAINT IF EXISTS "import_records_named_object";--> statement-breakpoint
ALTER TABLE "import_records" DROP COLUMN IF EXISTS "named";
