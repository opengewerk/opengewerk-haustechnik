-- Rolling the question about the duplicates of a list back to how 0044 left
-- the database.
--
-- What it costs an installation that runs it: nothing that is kept. The
-- function reads and writes no row. It answers for one serial number and one
-- mark again, as 0021 made it, which is how the application of before 0045
-- asks it: its import of assets names a duplicate only among the assets the
-- person importing sees.

DROP FUNCTION "asset_duplicate_candidates"(text[], text[]);--> statement-breakpoint
CREATE FUNCTION "asset_duplicate_candidates"("asked_serial" text, "asked_mark" text)
	RETURNS TABLE ("id" uuid, "serial_number" text, "mark" text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT a.id, a.serial_number, a.mark
	  FROM public.assets a
	 WHERE a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND a.deleted_at IS NULL
	   AND ((asked_serial IS NOT NULL AND a.serial_number IS NOT NULL
	         AND regexp_replace(a.serial_number, '[^0-9]', '', 'g') = regexp_replace(asked_serial, '[^0-9]', '', 'g'))
	     OR (asked_mark IS NOT NULL AND a.mark IS NOT NULL
	         AND regexp_replace(a.mark, '[^0-9]', '', 'g') = regexp_replace(asked_mark, '[^0-9]', '', 'g')))
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "asset_duplicate_candidates"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "asset_duplicate_candidates"(text, text) TO "opengewerk_app";
