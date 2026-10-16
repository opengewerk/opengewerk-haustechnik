-- The fault report without an account over a label (#332, section 4.7 of the
-- concept, decided 15.10.2026).
--
-- `fault_report_settings`: whether the label at a room or an asset takes a
-- report from somebody without an account, one row per operator, none is off.
-- The policy `tenant_isolation`, FORCE, no DELETE, and `readable_by_the_owner`
-- for the function below.
--
-- `fault_reports`: `reported_by` may be empty, exactly when the new column
-- `reported_outside` says the report came in over a label.
--
-- `fault_report_contacts`: the address for mail somebody without an account
-- gave, for the answer when the report is accepted and when it is done. On
-- purpose without the trigger of the change log: the log is a chain of hashes
-- over every value, and an address in it could not be taken out again (#355);
-- the concept removes it with the report done. So the application role may
-- DELETE here, and nothing else of the operator is in this table. It lies in
-- the area of its report and follows it over two keys, for which the reports
-- get two more unique constraints, with the policy `within_areas` (ADR 0003).
--
-- `session_areas()` takes one more area: the one named in `app.label_area`,
-- and only in a transaction without a person, which the route of a report
-- without an account opens for the area of its label (ADR 0003). With a
-- person set the setting is ignored, so nobody signed in widens their areas
-- with it.
--
-- `label_open_to_reports(code)`: SECURITY DEFINER, the second function of this
-- application that looks past the policies. It names the operator and the
-- area of a valid label at a room or an asset whose operator switched the
-- page on, and nothing for every other code, the same for each reason. It
-- reads the code as written and hands out no room, no asset and no name.
--
-- **Fits the version before it.** That version writes every report with a
-- person and never `reported_outside`, so it holds the new check, and it
-- reads no table that is new here.
CREATE TABLE "fault_report_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fault_report_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"address" text NOT NULL,
	"accepted_mailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fault_report_contacts_once" UNIQUE("tenant_id","fault_report_id"),
	CONSTRAINT "fault_report_contacts_address_shaped" CHECK (length("fault_report_contacts"."address") <= 254 and "fault_report_contacts"."address" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fault_report_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"open_by_label" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fault_report_settings_once" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "fault_report_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fault_reports" ALTER COLUMN "reported_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD COLUMN "reported_outside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_in_their_area" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_on_their_property" UNIQUE("tenant_id","id","property_id");--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD CONSTRAINT "fault_report_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD CONSTRAINT "fault_report_contacts_follow_their_report" FOREIGN KEY ("tenant_id","fault_report_id","area_id") REFERENCES "public"."fault_reports"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD CONSTRAINT "fault_report_contacts_of_a_report_of_their_property" FOREIGN KEY ("tenant_id","fault_report_id","property_id") REFERENCES "public"."fault_reports"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_report_settings" ADD CONSTRAINT "fault_report_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_reported_by_somebody" CHECK (("fault_reports"."reported_by" is null) = "fault_reports"."reported_outside");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fault_report_contacts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("fault_report_contacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("fault_report_contacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "fault_report_contacts" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fault_report_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("fault_report_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("fault_report_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "fault_report_settings" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
ALTER TABLE "fault_report_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fault_report_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fault_report_contacts" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fault_report_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "fault_report_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- As in 0002, and the area of a label for a transaction without a person.
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
	    UNION ALL
	    SELECT nullif(current_setting('app.label_area', true), '')::uuid
	     WHERE nullif(current_setting('app.user_id', true), '') IS NULL
	       AND nullif(current_setting('app.label_area', true), '') IS NOT NULL
	  ) AS held
$$;--> statement-breakpoint

-- The operator and the area of a label that takes a report without an
-- account; no row for any other code. Asked outside any operator, so it
-- looks past `tenant_isolation`; `readable_by_the_owner` on both tables is
-- what lets it.
CREATE FUNCTION "label_open_to_reports"("asked" text) RETURNS TABLE("tenant_id" uuid, "area_id" uuid)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT l.tenant_id, l.area_id
	  FROM public.labels l
	  JOIN public.fault_report_settings s
	    ON s.tenant_id = l.tenant_id AND s.open_by_label
	 WHERE l.code = asked
	   AND l.blocked_at IS NULL
	   AND l.deleted_at IS NULL
	   AND (l.asset_id IS NOT NULL OR l.room_id IS NOT NULL)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "label_open_to_reports"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "label_open_to_reports"(text) TO "opengewerk_app";
