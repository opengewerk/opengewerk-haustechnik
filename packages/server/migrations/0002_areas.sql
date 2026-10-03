-- The areas of a tenant, and who sees which (ADR 0003,
-- opengewerk-haustechnik#17).
--
-- An area bundles properties. Whoever answers for the properties in the north
-- sees and works on those and not the ones in the south. The database draws
-- that line: a row with a place carries its area, and a restrictive policy on
-- its table lets through the areas of the person of the transaction and no
-- others. No table has a place yet. The properties arrive with the next
-- migration and bring the policy along (`withinAreas` in the schema).
--
-- What a person sees is never handed to the database by the application. Two
-- functions read it from the tables below, from the person and the tenant the
-- foundation sets for every transaction:
--
-- - `session_sees_all_areas()`: the membership holds in every area, or the
--   person stands in today for somebody whose membership does, or the
--   transaction is a background run that said so with `app.all_areas`.
-- - `session_areas()`: the areas named for the person, and those of whoever
--   they stand in for today.
--
-- Nobody signed in means no area: without a person neither function finds a
-- row. A blocked membership sees nothing and stands in for nobody.
--
-- Everything down to the policies is what drizzle-kit generated from the
-- schema. What follows it is written by hand: the two functions, the areas a
-- new membership begins with, the audit trigger on the four tables, the areas
-- of the memberships already there, and FORCE and the grants.
--
-- **The areas a membership begins with** are given by a trigger on
-- `memberships`. Every way into a tenant writes a membership (the first run,
-- an invitation, add-staff, a further tenant), and none of them knows of
-- areas: they are the foundation's. A tenant without an area gets its first,
-- "Alle Liegenschaften", with its first membership. Whoever leads it and its
-- technical management see every area, everybody else the one area while
-- there is a single one, and none once there are more, until somebody names
-- theirs. The list of roles is `rolesSeeingEveryArea` in `domain`, and a test
-- holds the two together. A default and no rule: the areas of anybody may be
-- changed afterwards.
--
-- Not a trigger on `tenants`: a tenant is created by a function that runs as
-- the owner of the tables, and under FORCE no policy here lets the owner write
-- a row. A membership is written inside its tenant, under the application
-- role, after the step into it, and a trigger on it runs as that role.
--
-- **The memberships already there** are given the same, with `migration` as
-- the reason in the log of their tenant. Before FORCE, because no policy on
-- these tables names the owner. The memberships themselves are found through
-- `readable_by_the_owner`.
--
-- **Fits the version before it.** That version never asks these tables, and a
-- membership it writes after this migration is given its areas by the
-- trigger, which belongs to the database and not to the application.

CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "areas_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "areas_name_shaped" CHECK ("areas"."name" = btrim("areas"."name") and char_length("areas"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_all_areas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_all_areas_once" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "member_all_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_areas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_areas_once" UNIQUE("tenant_id","user_id","area_id")
);
--> statement-breakpoint
ALTER TABLE "member_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"substitute_user_id" text NOT NULL,
	"absent_user_id" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitutions_not_oneself" CHECK ("substitutions"."substitute_user_id" <> "substitutions"."absent_user_id"),
	CONSTRAINT "substitutions_in_order" CHECK ("substitutions"."starts_on" <= "substitutions"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "substitutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_all_areas" ADD CONSTRAINT "member_all_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_all_areas" ADD CONSTRAINT "member_all_areas_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_areas" ADD CONSTRAINT "member_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_areas" ADD CONSTRAINT "member_areas_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_areas" ADD CONSTRAINT "member_areas_area_of_the_tenant" FOREIGN KEY ("tenant_id","area_id") REFERENCES "public"."areas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_substitute_works_here" FOREIGN KEY ("tenant_id","substitute_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_absent_works_here" FOREIGN KEY ("tenant_id","absent_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_name_once" ON "areas" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "substitutions_substitute_idx" ON "substitutions" USING btree ("tenant_id","substitute_user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "areas" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_all_areas" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("member_all_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("member_all_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_areas" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("member_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("member_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "substitutions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("substitutions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("substitutions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Whether the person of this transaction sees every area of its tenant.
--
-- Invoker and STABLE: it reads with the rights and in the snapshot of the
-- statement that asks, under the policies of the tenant, and a policy calls
-- it once per statement because it calls it as a sub-select. `app.all_areas`
-- is set by the one way into the database the background runs have, for a
-- run that works for no person; no route sets it.
--
-- The day of a substitution is the day in Germany and not the one of the
-- server's clock, so that a substitution ending on a Friday ends at midnight
-- where the people it concerns are.
CREATE FUNCTION "session_sees_all_areas"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(current_setting('app.all_areas', true), '') = 'on'
	    OR EXISTS (
	         SELECT 1
	           FROM public.member_all_areas a
	           JOIN public.memberships m
	             ON m.tenant_id = a.tenant_id AND m.user_id = a.user_id
	          WHERE a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	            AND a.user_id = nullif(current_setting('app.user_id', true), '')
	            AND m.blocked_at IS NULL)
	    OR EXISTS (
	         SELECT 1
	           FROM public.substitutions s
	           JOIN public.memberships m
	             ON m.tenant_id = s.tenant_id AND m.user_id = s.substitute_user_id
	           JOIN public.member_all_areas a
	             ON a.tenant_id = s.tenant_id AND a.user_id = s.absent_user_id
	          WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	            AND s.substitute_user_id = nullif(current_setting('app.user_id', true), '')
	            AND m.blocked_at IS NULL
	            AND (now() AT TIME ZONE 'Europe/Berlin')::date BETWEEN s.starts_on AND s.ends_on)
$$;--> statement-breakpoint

-- The areas the person of this transaction sees, beside every area when the
-- function above says so: the ones named for them, and today those of whoever
-- they stand in for. The absent person may be blocked meanwhile; that is the
-- case the concept names, somebody leaves and the substitution takes over.
CREATE FUNCTION "session_areas"() RETURNS uuid[]
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

-- The areas a membership begins with, read from the membership itself, so
-- that no caller can claim a role for it.
--
-- The first area of a tenant comes into being here. Two first memberships at
-- the same moment would both make it; the unique index on the name lets one
-- of them through and the other finds it, with the count below in a snapshot
-- of its own.
--
-- The roles that see every area are `rolesSeeingEveryArea` in `domain`.
CREATE FUNCTION "grant_default_areas"(tenant uuid, person text) RETURNS void
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	held text[];
BEGIN
	SELECT m.roles INTO held
	  FROM public.memberships m
	 WHERE m.tenant_id = tenant AND m.user_id = person;

	IF held IS NULL THEN
		RETURN;
	END IF;

	INSERT INTO public.areas (tenant_id, name)
	SELECT tenant, 'Alle Liegenschaften'
	 WHERE NOT EXISTS (SELECT 1 FROM public.areas a WHERE a.tenant_id = tenant)
	ON CONFLICT DO NOTHING;

	IF held && ARRAY['management', 'technical_management']::text[] THEN
		INSERT INTO public.member_all_areas (tenant_id, user_id)
		VALUES (tenant, person)
		ON CONFLICT DO NOTHING;
	ELSIF (SELECT count(*) FROM public.areas a WHERE a.tenant_id = tenant) = 1 THEN
		INSERT INTO public.member_areas (tenant_id, user_id, area_id)
		SELECT tenant, person, a.id FROM public.areas a WHERE a.tenant_id = tenant
		ON CONFLICT DO NOTHING;
	END IF;
END;
$$;--> statement-breakpoint

-- A new membership, and only a new one: changing the roles of somebody later
-- leaves their areas as they are, and a membership that is let back in keeps
-- the areas it had.
CREATE FUNCTION "membership_gets_default_areas"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	PERFORM public.grant_default_areas(NEW.tenant_id, NEW.user_id);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "areas"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "member_all_areas"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "member_areas"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "substitutions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
SELECT "grant_default_areas"("tenant_id", "user_id")
  FROM "memberships"
 ORDER BY "tenant_id", "created_at";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
CREATE TRIGGER "default_areas" AFTER INSERT ON "memberships"
	FOR EACH ROW EXECUTE FUNCTION "membership_gets_default_areas"();--> statement-breakpoint
ALTER TABLE "areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_all_areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "substitutions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "areas" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "member_all_areas" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "member_areas" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "substitutions" TO "opengewerk_app";
