-- Rolling the reports without an account back to how 0064 left the database.
--
-- What it costs an installation that runs it: every report that came in over
-- a label, which names nobody and so cannot stand under the old check, and
-- every address waiting for an answer. The reports are never deleted, so the
-- rollback refuses as long as one of them stands.

DROP FUNCTION "label_open_to_reports"(text);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "session_areas"() RETURNS uuid[]
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(array_agg(DISTINCT held.area_id), '{}'::uuid[])
	  FROM (
	    SELECT ma.area_id
	      FROM public.member_areas ma
	      JOIN public.memberships m
	        ON m.tenant_id = ma.tenant_id AND m.user_id = ma.user_id
	     WHERE ma.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	       AND ma.user_id = nullif(current_setting('app.user_id', true), '')
	       AND m.blocked_at IS NULL
	    UNION ALL
	    SELECT ma.area_id
	      FROM public.substitutions s
	      JOIN public.memberships m
	        ON m.tenant_id = s.tenant_id AND m.user_id = s.substitute_user_id
	      JOIN public.member_areas ma
	        ON ma.tenant_id = s.tenant_id AND ma.user_id = s.absent_user_id
	     WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	       AND s.substitute_user_id = nullif(current_setting('app.user_id', true), '')
	       AND m.blocked_at IS NULL
	       AND (now() AT TIME ZONE 'Europe/Berlin')::date BETWEEN s.starts_on AND s.ends_on
	  ) AS held
$$;--> statement-breakpoint
DROP TABLE "fault_report_contacts";--> statement-breakpoint
DROP TABLE "fault_report_settings";--> statement-breakpoint
ALTER TABLE "fault_reports" DROP CONSTRAINT "fault_reports_reported_by_somebody";--> statement-breakpoint
ALTER TABLE "fault_reports" DROP CONSTRAINT "fault_reports_on_their_property";--> statement-breakpoint
ALTER TABLE "fault_reports" DROP CONSTRAINT "fault_reports_in_their_area";--> statement-breakpoint
ALTER TABLE "fault_reports" DROP COLUMN "reported_outside";--> statement-breakpoint
ALTER TABLE "fault_reports" ALTER COLUMN "reported_by" SET NOT NULL;
