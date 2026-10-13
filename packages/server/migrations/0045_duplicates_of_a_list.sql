-- The possible duplicates of the lines of a table, past the areas (#255, ADR
-- 0003, addendum on #255): the import of assets asks as the form in the office
-- and the exchange with a device do, and two areas that each read their list
-- in no longer make the same asset twice without anybody noticing.
--
-- `asset_duplicate_candidates` (0021) answered for one serial number and one
-- mark. A table has up to ten thousand lines, and asked line by line each
-- question would read every asset of the tenant again. The function takes
-- lists now: one pass over the assets, each held against the digits of
-- everything asked. It stays the one function that looks past the areas for
-- a duplicate; whoever asks about one asset asks with lists of one.
--
-- As before, what a duplicate is stays the rule of `domain`. Handed over are
-- only the assets whose digits fit a serial number or a mark that was asked,
-- a serial number against the serial numbers and a mark against the marks,
-- and the tenant is read from the transaction and is no argument.
DROP FUNCTION "asset_duplicate_candidates"(text, text);--> statement-breakpoint
CREATE FUNCTION "asset_duplicate_candidates"("asked_serials" text[], "asked_marks" text[])
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
	   AND ((a.serial_number IS NOT NULL
	         AND regexp_replace(a.serial_number, '[^0-9]', '', 'g') IN (
	             SELECT regexp_replace(asked, '[^0-9]', '', 'g')
	               FROM unnest(asked_serials) AS asked
	              WHERE asked IS NOT NULL))
	     OR (a.mark IS NOT NULL
	         AND regexp_replace(a.mark, '[^0-9]', '', 'g') IN (
	             SELECT regexp_replace(asked, '[^0-9]', '', 'g')
	               FROM unnest(asked_marks) AS asked
	              WHERE asked IS NOT NULL)))
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "asset_duplicate_candidates"(text[], text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "asset_duplicate_candidates"(text[], text[]) TO "opengewerk_app";
