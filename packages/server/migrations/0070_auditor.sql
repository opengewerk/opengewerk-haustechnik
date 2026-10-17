-- The auditor from outside (#339, section 4.3 of the concept, decided on
-- 15.10.2026): a role that reads the duties and their evidence, only up to a
-- last day (0069 and `endingRoles`), only in the properties and kinds of
-- assets its access names, and with every request written down.
--
-- - `member_limit_properties`, `member_limit_asset_kinds` and the two tables of
--   an invitation: what an access is limited to beside its areas. No row is no
--   limit. Written by the application with an invitation, the membership it
--   becomes and a change of roles (`areaAdditions`).
-- - `session_limit_properties()`, `session_limit_asset_kinds()`: read the
--   limits of the person of the transaction, null where there are none and
--   for a transaction without a person. Invoker's rights, like
--   `session_areas()`; the tables they read are kept apart by tenant alone.
-- - `within_limits`: a restrictive policy beside `within_areas` on
--   `properties`, `buildings`, `floors`, `rooms`, `assets`, `duties`,
--   `activities`, `activity_duties`, `evidence`, `evidence_voidings` and
--   `attachments`, so no other policy widens it. With a limit to kinds of
--   assets, what hangs on no asset is outside it; a document of an activity
--   within the limit is inside.
-- - `auditor_reads`: every request of an auditor, written before it is served.
--   SELECT and INSERT only, no trigger of the change log: it is a log itself.
-- - The role "Prüfer" as a row of every tenant that has roles, as in 0062.

CREATE TABLE "invitation_limit_asset_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"asset_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_limit_asset_kinds_once" UNIQUE("tenant_id","invitation_id","asset_kind"),
	CONSTRAINT "invitation_limit_asset_kinds_key" CHECK ("invitation_limit_asset_kinds"."asset_kind" ~ '^[a-z0-9_]+\.[a-z0-9_]+$')
);--> statement-breakpoint
ALTER TABLE "invitation_limit_asset_kinds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitation_limit_properties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_limit_properties_once" UNIQUE("tenant_id","invitation_id","property_id")
);--> statement-breakpoint
ALTER TABLE "invitation_limit_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_limit_asset_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"asset_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_limit_asset_kinds_once" UNIQUE("tenant_id","user_id","asset_kind"),
	CONSTRAINT "member_limit_asset_kinds_key" CHECK ("member_limit_asset_kinds"."asset_kind" ~ '^[a-z0-9_]+\.[a-z0-9_]+$')
);--> statement-breakpoint
ALTER TABLE "member_limit_asset_kinds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_limit_properties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_limit_properties_once" UNIQUE("tenant_id","user_id","property_id")
);--> statement-breakpoint
ALTER TABLE "member_limit_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auditor_reads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"route" text NOT NULL,
	"path" text NOT NULL,
	"query" text
);--> statement-breakpoint
ALTER TABLE "auditor_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_limit_asset_kinds" ADD CONSTRAINT "invitation_limit_asset_kinds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_limit_asset_kinds" ADD CONSTRAINT "invitation_limit_asset_kinds_of_an_invitation" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_limit_properties" ADD CONSTRAINT "invitation_limit_properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_limit_properties" ADD CONSTRAINT "invitation_limit_properties_of_an_invitation" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_limit_properties" ADD CONSTRAINT "invitation_limit_properties_property_of_the_tenant" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_limit_asset_kinds" ADD CONSTRAINT "member_limit_asset_kinds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_limit_asset_kinds" ADD CONSTRAINT "member_limit_asset_kinds_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_limit_properties" ADD CONSTRAINT "member_limit_properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_limit_properties" ADD CONSTRAINT "member_limit_properties_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_limit_properties" ADD CONSTRAINT "member_limit_properties_property_of_the_tenant" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditor_reads" ADD CONSTRAINT "auditor_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditor_reads" ADD CONSTRAINT "auditor_reads_of_somebody_who_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditor_reads_newest_idx" ON "auditor_reads" USING btree ("tenant_id","read_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitation_limit_asset_kinds" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("invitation_limit_asset_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invitation_limit_asset_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitation_limit_properties" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("invitation_limit_properties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invitation_limit_properties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_limit_asset_kinds" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("member_limit_asset_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("member_limit_asset_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_limit_properties" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("member_limit_properties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("member_limit_properties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auditor_reads" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("auditor_reads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("auditor_reads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- The limits of the person of this transaction, null where there are none.
CREATE FUNCTION "session_limit_properties"() RETURNS uuid[]
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT CASE WHEN count(*) = 0 THEN NULL ELSE array_agg(l.property_id) END
	  FROM public.member_limit_properties l
	 WHERE l.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND l.user_id = nullif(current_setting('app.user_id', true), '')
$$;--> statement-breakpoint

CREATE FUNCTION "session_limit_asset_kinds"() RETURNS text[]
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT CASE WHEN count(*) = 0 THEN NULL ELSE array_agg(l.asset_kind) END
	  FROM public.member_limit_asset_kinds l
	 WHERE l.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND l.user_id = nullif(current_setting('app.user_id', true), '')
$$;--> statement-breakpoint

CREATE POLICY "within_limits" ON "buildings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "buildings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "buildings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
CREATE POLICY "within_limits" ON "floors" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "floors"."property_id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "floors"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
CREATE POLICY "within_limits" ON "properties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "properties"."id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "properties"."id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
CREATE POLICY "within_limits" ON "rooms" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "rooms"."property_id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "rooms"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
CREATE POLICY "within_limits" ON "assets" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "assets"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR "assets"."kind" = ANY ((SELECT session_limit_asset_kinds())::text[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "assets"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR "assets"."kind" = ANY ((SELECT session_limit_asset_kinds())::text[])));--> statement-breakpoint
CREATE POLICY "within_limits" ON "duties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "duties"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("duties"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "duties"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "duties"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("duties"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "duties"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "within_limits" ON "evidence" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "evidence"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.duties d WHERE d.id = "evidence"."duty_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "evidence"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.duties d WHERE d.id = "evidence"."duty_id")));--> statement-breakpoint
CREATE POLICY "within_limits" ON "evidence_voidings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "evidence_voidings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = "evidence_voidings"."evidence_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "evidence_voidings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = "evidence_voidings"."evidence_id")));--> statement-breakpoint
CREATE POLICY "within_limits" ON "activities" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "activities"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("activities"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "activities"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "activities"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("activities"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "activities"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "within_limits" ON "activity_duties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "activity_duties"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = "activity_duties"."activity_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "activity_duties"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = "activity_duties"."activity_id")));--> statement-breakpoint
CREATE POLICY "within_limits" ON "attachments" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "attachments"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("attachments"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "attachments"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))) OR ("attachments"."activity_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = "attachments"."activity_id")))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "attachments"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("attachments"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "attachments"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))) OR ("attachments"."activity_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = "attachments"."activity_id"))));--> statement-breakpoint

ALTER TABLE "member_limit_properties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_limit_asset_kinds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_limit_properties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_limit_asset_kinds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auditor_reads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "member_limit_properties" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "member_limit_asset_kinds" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "invitation_limit_properties" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "invitation_limit_asset_kinds" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "auditor_reads" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "member_limit_properties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "member_limit_asset_kinds"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "invitation_limit_properties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "invitation_limit_asset_kinds"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- The Prüfer as a row of every tenant that has roles, as the Melder in 0062.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
INSERT INTO "tenant_roles" ("tenant_id", "key", "label", "rights", "leads", "second_factor")
SELECT DISTINCT "held"."tenant_id", 'auditor', 'Prüfer', ARRAY['duty.read', 'evidence.read', 'sync.read']::text[], false, false
  FROM "tenant_roles" AS "held"
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
