-- Asset kinds and fields of an operator's own (#62, sections 2.5 and 4.2 of
-- the concept, decided on 15.10.2026).
--
-- `own_asset_kinds`: a kind no package describes, under `eigen.<key>`, with
-- its label, its cost group and the documents an asset of it is expected to
-- have. `own_asset_fields`: a field at one of them or at a kind of a package,
-- the same thing either way, under `eigen_<key>`. Both tenant-wide and
-- without an area, both in the log of the tenant, neither travels as a
-- record: the server hands them to a device inside the catalogue. Removed by
-- marking, so the application role has no DELETE.
--
-- `own_kind_uses()` says how many assets of the tenant carry each own kind,
-- how many hold a value of each own field and which choices of a choice are
-- held. It looks past the areas on purpose: a kind or a field is removed only
-- while no asset uses it, and an asset in an area of somebody else counts as
-- well. Handed over are counts and the values of choices, which are codes of
-- the field, never a text an asset holds and never an id.
-- It runs as the owner, who reads the two tables through `readable_by_the_owner`
-- as it reads the assets.
--
-- The right "Eigene Anlagenarten und Felder führen" (`kind.write`) for the
-- tenants that are there, as in 0066: the Leitung and the Technische Leitung.
--
-- **Fits the version before it.** That version knows neither table, and a role
-- that holds a right it does not know is a role it reads as it is.
CREATE TABLE "own_asset_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_kind" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort" text NOT NULL,
	"unit" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "own_asset_fields_key_once" UNIQUE("tenant_id","key"),
	CONSTRAINT "own_asset_fields_kind_shaped" CHECK ("own_asset_fields"."asset_kind" = btrim("own_asset_fields"."asset_kind") and char_length("own_asset_fields"."asset_kind") between 1 and 120),
	CONSTRAINT "own_asset_fields_key_shaped" CHECK ("own_asset_fields"."key" ~ '^eigen_[a-z0-9]+(_[a-z0-9]+)*$' and char_length("own_asset_fields"."key") <= 60),
	CONSTRAINT "own_asset_fields_label_shaped" CHECK ("own_asset_fields"."label" = btrim("own_asset_fields"."label") and char_length("own_asset_fields"."label") between 1 and 120),
	CONSTRAINT "own_asset_fields_sort_known" CHECK ("sort" in ('text', 'number', 'date', 'flag', 'choice')),
	CONSTRAINT "own_asset_fields_unit_shaped" CHECK ("own_asset_fields"."unit" is null or ("own_asset_fields"."unit" = btrim("own_asset_fields"."unit") and char_length("own_asset_fields"."unit") between 1 and 20)),
	CONSTRAINT "own_asset_fields_unit_of_a_number" CHECK ("own_asset_fields"."unit" is null or "own_asset_fields"."sort" = 'number'),
	CONSTRAINT "own_asset_fields_options_listed" CHECK (jsonb_typeof("own_asset_fields"."options") = 'array')
);
--> statement-breakpoint
ALTER TABLE "own_asset_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "own_asset_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"cost_group" text NOT NULL,
	"expected_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "own_asset_kinds_key_once" UNIQUE("tenant_id","key"),
	CONSTRAINT "own_asset_kinds_key_shaped" CHECK ("own_asset_kinds"."key" ~ '^eigen\.[a-z0-9]+(_[a-z0-9]+)*$' and char_length("own_asset_kinds"."key") <= 60),
	CONSTRAINT "own_asset_kinds_label_shaped" CHECK ("own_asset_kinds"."label" = btrim("own_asset_kinds"."label") and char_length("own_asset_kinds"."label") between 1 and 120),
	CONSTRAINT "own_asset_kinds_cost_group_shaped" CHECK ("own_asset_kinds"."cost_group" ~ '^[0-9]{3}$'),
	CONSTRAINT "own_asset_kinds_documents_listed" CHECK (jsonb_typeof("own_asset_kinds"."expected_documents") = 'array'),
	CONSTRAINT "own_asset_kinds_revision_counted" CHECK ("own_asset_kinds"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "own_asset_kinds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "own_asset_fields" ADD CONSTRAINT "own_asset_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_asset_kinds" ADD CONSTRAINT "own_asset_kinds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "own_asset_fields" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("own_asset_fields"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("own_asset_fields"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "own_asset_kinds" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("own_asset_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("own_asset_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "own_asset_fields" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "own_asset_kinds" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
ALTER TABLE "own_asset_kinds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "own_asset_fields" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "own_asset_kinds" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "own_asset_fields" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "own_asset_kinds"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "own_asset_fields"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE FUNCTION "own_kind_uses"()
	RETURNS TABLE ("asset_kind" text, "field_key" text, "assets" integer, "held" text[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT k.key, NULL::text,
	       (SELECT count(*)::integer
	          FROM public.assets a
	         WHERE a.tenant_id = k.tenant_id AND a.kind = k.key),
	       NULL::text[]
	  FROM public.own_asset_kinds k
	 WHERE k.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND k.deleted_at IS NULL
	UNION ALL
	SELECT f.asset_kind, f.key, count(a.id)::integer,
	       CASE WHEN f.sort = 'choice'
	            THEN array_remove(array_agg(DISTINCT a."values" ->> f.key), NULL)
	       END
	  FROM public.own_asset_fields f
	  LEFT JOIN public.assets a
	    ON a.tenant_id = f.tenant_id AND a.kind = f.asset_kind AND a."values" ? f.key
	 WHERE f.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND f.deleted_at IS NULL
	 GROUP BY f.asset_kind, f.key, f.sort
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "own_kind_uses"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "own_kind_uses"() TO "opengewerk_app";--> statement-breakpoint
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
			('management', ARRAY['kind.write']::text[]),
			('technical_management', ARRAY['kind.write']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
