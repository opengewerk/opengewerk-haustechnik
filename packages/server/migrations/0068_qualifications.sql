-- The qualifications of the people who work for the operator (#337, section
-- 4.3 of the concept, decided 15.10.2026), bound from the factory of the
-- foundation (ADR 0012 in the repository opengewerk).
--
-- `qualification_kinds`: the kinds the operator adds to those of the
-- packages, with a label and a level. `qualifications`: what a person of the
-- tenant holds, of exactly one kind (a key of the catalogue or an own kind),
-- until a day or without one, with a note and the certificate as a file of
-- the store. Both tenant-wide and without an area: the policy
-- `tenant_isolation` alone, FORCE; the routes ask for the rights to see and
-- to keep them, or that the qualification is the person's own. Both are
-- marked and never removed: the application may read, add and change a row.
--
-- `deadlines.qualification_id`: the expiry of a qualification, without a
-- place like a contract. The key onto the deadlines, which have rows, is laid
-- while they are not under FORCE, as 0067 does it (#315).
--
-- The rights "Qualifikationen ansehen" (`qualification.read`: Leitung,
-- Technische Leitung, Objektleitung) and "Qualifikationen führen"
-- (`qualification.write`: Leitung, Technische Leitung), decided 15.10.2026,
-- for the tenants that are already there, as in 0067.
--
-- **Fits the version before it.** The new column of the deadlines is empty
-- and nullable, the version before writes none, and the checks of the
-- deadlines it writes still hold with it empty.
CREATE TABLE "qualification_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "qualification_kinds_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "qualification_kinds_label_fits" CHECK (char_length("qualification_kinds"."label") between 1 and 120),
	CONSTRAINT "qualification_kinds_level_known" CHECK ("qualification_kinds"."level" in ('instructed_person', 'skilled_person', 'competent_person'))
);
--> statement-breakpoint
ALTER TABLE "qualification_kinds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind_key" text,
	"own_kind_id" uuid,
	"valid_until" date,
	"note" text,
	"certificate_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "qualifications_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "qualifications_one_kind" CHECK (num_nonnulls("qualifications"."kind_key", "qualifications"."own_kind_id") = 1),
	CONSTRAINT "qualifications_kind_key_fits" CHECK ("qualifications"."kind_key" is null or char_length("qualifications"."kind_key") between 1 and 120),
	CONSTRAINT "qualifications_note_fits" CHECK ("qualifications"."note" is null or char_length("qualifications"."note") between 1 and 500),
	CONSTRAINT "qualifications_certificate_is_a_hash" CHECK ("qualifications"."certificate_sha256" is null or "qualifications"."certificate_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "qualifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "qualification_id" uuid;--> statement-breakpoint
ALTER TABLE "qualification_kinds" ADD CONSTRAINT "qualification_kinds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_of_somebody_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_of_an_own_kind" FOREIGN KEY ("tenant_id","own_kind_id") REFERENCES "public"."qualification_kinds"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_certificate_stored" FOREIGN KEY ("tenant_id","certificate_sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_kinds_label_once" ON "qualification_kinds" USING btree ("tenant_id",lower("label")) WHERE "qualification_kinds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "qualifications_of_a_person" ON "qualifications" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_qualification" FOREIGN KEY ("tenant_id","qualification_id") REFERENCES "public"."qualifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deadlines_qualification_idx" ON "deadlines" USING btree ("tenant_id","qualification_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null or "deadlines"."delegation_id" is not null or "deadlines"."qualification_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null) and ("deadlines"."delegation_id" is null or "deadlines"."property_id" is null) and ("deadlines"."qualification_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "qualification_kinds" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("qualification_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("qualification_kinds"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "qualifications" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("qualifications"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("qualifications"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qualification_kinds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qualifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Marked and never removed, like everything else that travels.
GRANT SELECT, INSERT, UPDATE ON "qualification_kinds" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "qualifications" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "qualification_kinds"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "qualifications"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
-- The version and the change number a device asks for more by, kept true like
-- every table that travels.
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "qualification_kinds"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "qualifications"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

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
			('management', ARRAY['qualification.read', 'qualification.write']::text[]),
			('technical_management', ARRAY['qualification.read', 'qualification.write']::text[]),
			('site_management', ARRAY['qualification.read']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
