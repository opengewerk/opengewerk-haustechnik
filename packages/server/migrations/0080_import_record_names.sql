-- What an import made, with the names it made it with (#422): the log of a
-- record an import made has no entry that names it, since the import is one
-- entry in the place of one for every record (0022). `named` holds `name`,
-- `number` and `kind` as the import wrote them, as text, and the log reads
-- them for a record whose own entries name none of them. What the record is
-- called today is not the answer: the log says what was.
--
-- The trigger of 0078 writes the names from here on. A row from before has
-- none; no installation has imported between 0078 and this migration, since
-- no version brought one without the other.
ALTER TABLE "import_records" ADD COLUMN "named" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_named_object" CHECK (jsonb_typeof("import_records"."named") = 'object');--> statement-breakpoint
CREATE OR REPLACE FUNCTION "import_record"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	INSERT INTO public.import_records (tenant_id, import_id, table_name, record_id, named)
	VALUES (
		new.tenant_id,
		nullif(current_setting('app.import_id', true), '')::uuid,
		tg_table_name,
		new.id,
		(SELECT coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
		   FROM jsonb_each_text(to_jsonb(new)) AS field
		  WHERE field.key IN ('name', 'number', 'kind'))
	);

	RETURN NULL;
END;
$$;
