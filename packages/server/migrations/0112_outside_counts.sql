-- The limits of the page of a label for somebody without an account in the
-- database (#540), where they were kept in the memory of one process: a
-- restart set them back, and two processes counted apart.
--
-- `outside_counts`: one row each time the page was opened from an address, a
-- report was asked for from one, or a report over a label was written, by
-- the kind and the SHA-256 of the address or the code, never the address
-- itself, and the moment. No tenant: the page comes before any operator.
-- Protected like a table of the instance: row level security forced, the
-- owner keeps it through the function, and the application role, which may
-- only read it, sees no row of it anywhere.
-- `outside_take(...)`: SECURITY DEFINER, the one way to it. It forgets every
-- row older than an hour first, so that no count holds a hash longer than the
-- hour it counts for; then, under a lock per key held to the end of the
-- transaction, it tells whether once more is allowed under each key and, if
-- so, counts it under those named. Called in the transaction of the report
-- itself for a label, so that a report that fails after it counts nothing.
CREATE TABLE "outside_counts" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "outside_counts_kind_known" CHECK ("outside_counts"."kind" in ('page', 'address', 'label')),
	CONSTRAINT "outside_counts_key_shaped" CHECK ("outside_counts"."key" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "outside_counts_by_key" ON "outside_counts" USING btree ("kind","key","at");--> statement-breakpoint
ALTER TABLE "outside_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outside_counts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "outside_counts" FROM PUBLIC;--> statement-breakpoint
CREATE POLICY "kept_by_the_function" ON "outside_counts" AS PERMISSIVE FOR ALL TO current_user USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "seen_by_nobody" ON "outside_counts" AS PERMISSIVE FOR SELECT TO "opengewerk_app" USING (false);--> statement-breakpoint
GRANT SELECT ON "outside_counts" TO "opengewerk_app";--> statement-breakpoint
CREATE FUNCTION "outside_take"(
	"kinds" text[],
	"keys" text[],
	"limits" integer[],
	"counted" text[],
	"at" timestamp with time zone
) RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	i integer;
BEGIN
	IF coalesce(array_length(kinds, 1), 0) = 0
	   OR array_length(keys, 1) IS DISTINCT FROM array_length(kinds, 1)
	   OR array_length(limits, 1) IS DISTINCT FROM array_length(kinds, 1) THEN
		RAISE EXCEPTION 'outside_take takes one key and one limit for each kind';
	END IF;

	DELETE FROM public.outside_counts c WHERE c.at <= outside_take.at - interval '1 hour';

	FOR i IN 1 .. array_length(kinds, 1) LOOP
		PERFORM pg_advisory_xact_lock(hashtextextended('outside:' || kinds[i] || ':' || keys[i], 0));
	END LOOP;

	FOR i IN 1 .. array_length(kinds, 1) LOOP
		IF (SELECT count(*) FROM public.outside_counts c
		     WHERE c.kind = kinds[i] AND c.key = keys[i] AND c.at > outside_take.at - interval '1 hour') >= limits[i] THEN
			RETURN false;
		END IF;
	END LOOP;

	FOR i IN 1 .. array_length(kinds, 1) LOOP
		IF kinds[i] = ANY (counted) THEN
			INSERT INTO public.outside_counts (kind, key, at) VALUES (kinds[i], keys[i], outside_take.at);
		END IF;
	END LOOP;

	RETURN true;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "outside_take"(text[], text[], integer[], text[], timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "outside_take"(text[], text[], integer[], text[], timestamp with time zone) TO "opengewerk_app";
