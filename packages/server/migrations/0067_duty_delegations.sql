-- The delegation of the operator's duties (#336, section 4.3 of the concept,
-- decided 15.10.2026).
--
-- `duty_delegations`: a delegation to a person of the tenant, with the name it
-- was written with, its scope (every duty, or certain packages or cost
-- groups), its tasks and powers, its start and its end. `duty_delegation_areas`:
-- the areas it names, a row each. Both tenant-wide like a contract: the policy
-- `tenant_isolation` alone, FORCE; the routes ask for the right to delegate or
-- that the person asking is the one it goes to. A trigger refuses every
-- change to either, and the removal of a delegation, once somebody signed it,
-- for every role.
--
-- `duty_delegation_signatures`: the Leitung for the operator and the person
-- for themself, each once, with the fingerprint of the page.
-- `duty_delegation_revocations`: the day a revocation ends it on, with the
-- reason. Both written once, as every signature: the application may read and
-- add a row, and a trigger refuses a change for every role.
--
-- `duties.responsible_delegation_id`: the delegation the person who answers
-- comes from, over a key with that person, so that it is the one the
-- delegation goes to. `deadlines.delegation_id`: the end of a delegation,
-- without a place like a contract. The keys onto the duties and the deadlines,
-- which have rows, are laid while neither is under FORCE, as 0060 does it
-- (#315).
--
-- The right "Pflichten übertragen" (`duty.delegate`, decided 15.10.2026: only
-- the Leitung) for the tenants that are already there, as in 0060.
--
-- **Fits the version before it.** Every new column is empty and nullable, the
-- version before writes none of them, and the checks of the deadlines it
-- writes still hold with the new column empty.
CREATE TYPE "public"."delegation_role" AS ENUM('operator', 'delegate');--> statement-breakpoint
CREATE TYPE "public"."delegation_scope" AS ENUM('all', 'packages', 'cost_groups');--> statement-breakpoint
CREATE TABLE "duty_delegation_areas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_delegation_areas_once" UNIQUE("tenant_id","delegation_id","area_id")
);
--> statement-breakpoint
ALTER TABLE "duty_delegation_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "duty_delegation_revocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"reason" text NOT NULL,
	"revoked_by" text NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_delegation_revocations_once" UNIQUE("tenant_id","delegation_id"),
	CONSTRAINT "duty_delegation_revocations_reason_shaped" CHECK ("duty_delegation_revocations"."reason" = btrim("duty_delegation_revocations"."reason") and char_length("duty_delegation_revocations"."reason") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "duty_delegation_revocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "duty_delegation_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"role" "delegation_role" NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"path" text,
	"typed_name" text,
	"page_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_delegation_signatures_once" UNIQUE("tenant_id","delegation_id","role"),
	CONSTRAINT "duty_delegation_signatures_path_shaped" CHECK ("duty_delegation_signatures"."path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length("duty_delegation_signatures"."path") <= 40000),
	CONSTRAINT "duty_delegation_signatures_one_way" CHECK (num_nonnulls("duty_delegation_signatures"."path", "duty_delegation_signatures"."typed_name") = 1),
	CONSTRAINT "duty_delegation_signatures_typed_name_shaped" CHECK ("duty_delegation_signatures"."typed_name" is null or ("duty_delegation_signatures"."typed_name" = btrim("duty_delegation_signatures"."typed_name") and char_length("duty_delegation_signatures"."typed_name") between 1 and 200)),
	CONSTRAINT "duty_delegation_signatures_page_fingerprint_shaped" CHECK ("duty_delegation_signatures"."page_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "duty_delegation_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "duty_delegations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delegate_user_id" text NOT NULL,
	"delegate_name" text NOT NULL,
	"scope" "delegation_scope" NOT NULL,
	"packages" text[] DEFAULT '{}'::text[] NOT NULL,
	"cost_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"tasks" text NOT NULL,
	"powers" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_delegations_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "duty_delegations_of_their_person" UNIQUE("tenant_id","id","delegate_user_id"),
	CONSTRAINT "duty_delegations_delegate_name_shaped" CHECK ("duty_delegations"."delegate_name" = btrim("duty_delegations"."delegate_name") and char_length("duty_delegations"."delegate_name") between 1 and 200),
	CONSTRAINT "duty_delegations_tasks_shaped" CHECK ("duty_delegations"."tasks" = btrim("duty_delegations"."tasks") and char_length("duty_delegations"."tasks") between 1 and 4000),
	CONSTRAINT "duty_delegations_powers_shaped" CHECK ("duty_delegations"."powers" = btrim("duty_delegations"."powers") and char_length("duty_delegations"."powers") between 1 and 4000),
	CONSTRAINT "duty_delegations_in_order" CHECK ("duty_delegations"."starts_on" <= "duty_delegations"."ends_on"),
	CONSTRAINT "duty_delegations_scope_shaped" CHECK (("duty_delegations"."scope" = 'packages') = (cardinality("duty_delegations"."packages") > 0)
        and ("duty_delegations"."scope" = 'cost_groups') = (cardinality("duty_delegations"."cost_groups") > 0)
        and cardinality("duty_delegations"."packages") <= 100
        and cardinality("duty_delegations"."cost_groups") <= 100
        and array_to_string("duty_delegations"."packages", ',') ~ '^([a-z][a-z0-9_-]{0,63}(,[a-z][a-z0-9_-]{0,63})*)?$'
        and array_to_string("duty_delegations"."cost_groups", ',') ~ '^([1-9][0-9]{2}(,[1-9][0-9]{2})*)?$')
);
--> statement-breakpoint
ALTER TABLE "duty_delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "responsible_delegation_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "delegation_id" uuid;--> statement-breakpoint
ALTER TABLE "duty_delegation_areas" ADD CONSTRAINT "duty_delegation_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_areas" ADD CONSTRAINT "duty_delegation_areas_of_a_delegation" FOREIGN KEY ("tenant_id","delegation_id") REFERENCES "public"."duty_delegations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_areas" ADD CONSTRAINT "duty_delegation_areas_of_an_area_here" FOREIGN KEY ("tenant_id","area_id") REFERENCES "public"."areas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_revocations" ADD CONSTRAINT "duty_delegation_revocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_revocations" ADD CONSTRAINT "duty_delegation_revocations_of_a_delegation" FOREIGN KEY ("tenant_id","delegation_id") REFERENCES "public"."duty_delegations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_revocations" ADD CONSTRAINT "duty_delegation_revocations_by_somebody_here" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_signatures" ADD CONSTRAINT "duty_delegation_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_signatures" ADD CONSTRAINT "duty_delegation_signatures_under_a_delegation" FOREIGN KEY ("tenant_id","delegation_id") REFERENCES "public"."duty_delegations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegation_signatures" ADD CONSTRAINT "duty_delegation_signatures_by_somebody_here" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegations" ADD CONSTRAINT "duty_delegations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_delegations" ADD CONSTRAINT "duty_delegations_to_somebody_here" FOREIGN KEY ("tenant_id","delegate_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duty_delegations_delegate_idx" ON "duty_delegations" USING btree ("tenant_id","delegate_user_id");--> statement-breakpoint
ALTER TABLE "duties" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_responsible_from_their_delegation" FOREIGN KEY ("tenant_id","responsible_delegation_id","responsible_user_id") REFERENCES "public"."duty_delegations"("tenant_id","id","delegate_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_delegation" FOREIGN KEY ("tenant_id","delegation_id") REFERENCES "public"."duty_delegations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duties_delegation_idx" ON "duties" USING btree ("tenant_id","responsible_delegation_id");--> statement-breakpoint
CREATE INDEX "deadlines_delegation_idx" ON "deadlines" USING btree ("tenant_id","delegation_id");--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_delegation_names_a_person" CHECK ("duties"."responsible_delegation_id" is null or "duties"."responsible_user_id" is not null);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null or "deadlines"."delegation_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null) and ("deadlines"."delegation_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id") = 1);--> statement-breakpoint
ALTER TABLE "duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "duty_delegation_areas" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("duty_delegation_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("duty_delegation_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "duty_delegation_revocations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("duty_delegation_revocations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("duty_delegation_revocations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "duty_delegation_signatures" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("duty_delegation_signatures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("duty_delegation_signatures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "duty_delegations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("duty_delegations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("duty_delegations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "duty_delegations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duty_delegation_areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duty_delegation_signatures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duty_delegation_revocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "duty_delegations" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "duty_delegation_areas" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "duty_delegation_signatures" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "duty_delegation_revocations" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "duty_delegations"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "duty_delegation_areas"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "duty_delegation_signatures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "duty_delegation_revocations"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- A delegation and its areas stay as they were signed: from the first
-- signature on, nothing of them changes and the delegation is not removed,
-- for every role. Not SECURITY DEFINER: whoever may change a delegation sees
-- its signatures, the statement names the tenant.
CREATE FUNCTION "delegation_kept_as_signed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	delegation uuid;
	tenant uuid;
BEGIN
	IF tg_table_name = 'duty_delegations' THEN
		delegation := old.id;
		tenant := old.tenant_id;
	ELSIF tg_op = 'INSERT' THEN
		delegation := new.delegation_id;
		tenant := new.tenant_id;
	ELSE
		delegation := old.delegation_id;
		tenant := old.tenant_id;
	END IF;

	IF EXISTS (SELECT 1 FROM public.duty_delegation_signatures AS signature
	            WHERE signature.tenant_id = tenant AND signature.delegation_id = delegation) THEN
		RAISE EXCEPTION 'Eine Pflichtenübertragung mit Unterschrift wird nicht geändert und nicht entfernt. Sie bleibt, wie sie unterschrieben wurde; beenden lässt sie sich mit einem Widerruf.'
			USING ERRCODE = 'HT005';
	END IF;

	IF tg_op = 'DELETE' THEN
		RETURN old;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_signed" BEFORE UPDATE OR DELETE ON "duty_delegations"
	FOR EACH ROW EXECUTE FUNCTION "delegation_kept_as_signed"();--> statement-breakpoint
CREATE TRIGGER "kept_as_signed" BEFORE INSERT OR UPDATE OR DELETE ON "duty_delegation_areas"
	FOR EACH ROW EXECUTE FUNCTION "delegation_kept_as_signed"();--> statement-breakpoint

-- A signature and a revocation are written once, for every role.
CREATE FUNCTION "delegation_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_table_name = 'duty_delegation_signatures' THEN
		RAISE EXCEPTION 'Eine Unterschrift unter einer Pflichtenübertragung wird nicht geändert und nicht gelöscht.'
			USING ERRCODE = 'HT005';
	END IF;

	RAISE EXCEPTION 'Ein Widerruf einer Pflichtenübertragung wird nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "duty_delegation_signatures"
	FOR EACH ROW EXECUTE FUNCTION "delegation_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "duty_delegation_signatures"
	FOR EACH STATEMENT EXECUTE FUNCTION "delegation_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "duty_delegation_revocations"
	FOR EACH ROW EXECUTE FUNCTION "delegation_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "duty_delegation_revocations"
	FOR EACH STATEMENT EXECUTE FUNCTION "delegation_kept_as_written"();--> statement-breakpoint

-- The right for the tenants that are already there, as in 0060.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" AS "role"
   SET "rights" = "role"."rights" || "missing"."rights",
       "updated_at" = now()
  FROM (
	SELECT "held"."id",
	       array_agg("shipped"."right" ORDER BY "shipped"."position") AS "rights"
	  FROM "tenant_roles" AS "held"
	  JOIN (
		VALUES
			('management', ARRAY['duty.delegate']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
