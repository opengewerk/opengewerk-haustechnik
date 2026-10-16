-- The contractors of an operator (#328, section 4.11 of the concept).
--
-- `contractors`: a firm with its address, the cost groups it works in and a
-- note. It belongs to the operator and lies in no area (2.8): the policy
-- `tenant_isolation` alone, FORCE, and no DELETE for the application role, as
-- a firm is marked and never removed. Every device holds the firms, to name
-- the one of an order.
--
-- `duties`, `activities` and `evidence` name a firm of the list in
-- `contractor_id`, over a key with the tenant. A duty and an activity name
-- one only where a contractor carries them out. Evidence keeps its
-- organisation as it was written and names the firm beside it.
--
-- The rights "Fremdfirmen ansehen" (`contractor.read`, all four roles) and
-- "Fremdfirmen pflegen" (`contractor.write`, Leitung and Technische Leitung),
-- decided on 15.10.2026, for the tenants that are already there, as in 0046.
--
-- The keys onto the firm are laid while none of the tables is under FORCE, as
-- 0051 does it: an installation migrates as the owner, and under FORCE
-- PostgreSQL checks a key only against what the policies show (#315).

CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"postal_code" text,
	"city" text,
	"phone" text,
	"email" text,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "contractors_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contractors_name_shaped" CHECK ("contractors"."name" = btrim("contractors"."name") and char_length("contractors"."name") between 1 and 120),
	CONSTRAINT "contractors_street_shaped" CHECK ("contractors"."street" is null or ("contractors"."street" = btrim("contractors"."street") and char_length("contractors"."street") between 1 and 120)),
	CONSTRAINT "contractors_postal_code_shaped" CHECK ("contractors"."postal_code" is null or ("contractors"."postal_code" = btrim("contractors"."postal_code") and char_length("contractors"."postal_code") between 1 and 10)),
	CONSTRAINT "contractors_city_shaped" CHECK ("contractors"."city" is null or ("contractors"."city" = btrim("contractors"."city") and char_length("contractors"."city") between 1 and 80)),
	CONSTRAINT "contractors_phone_shaped" CHECK ("contractors"."phone" is null or ("contractors"."phone" = btrim("contractors"."phone") and char_length("contractors"."phone") between 1 and 40)),
	CONSTRAINT "contractors_email_shaped" CHECK ("contractors"."email" is null or ("contractors"."email" = btrim("contractors"."email") and char_length("contractors"."email") between 1 and 254)),
	CONSTRAINT "contractors_note_shaped" CHECK ("contractors"."note" is null or ("contractors"."note" = btrim("contractors"."note") and char_length("contractors"."note") between 1 and 500)),
	CONSTRAINT "contractors_services_of_the_list" CHECK ("contractors"."services" <@ array['410', '420', '430', '440', '450', '460', '470', '480', '490', '610']::text[])
);
--> statement-breakpoint
ALTER TABLE "contractors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "contractor_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "contractor_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "contractor_id" uuid;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractors_tenant_name_idx" ON "contractors" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "duties" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractors" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_name_their_contractor" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_name_their_contractor" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_name_their_contractor" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "duties_contractor_idx" ON "duties" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
CREATE INDEX "evidence_contractor_idx" ON "evidence" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
CREATE INDEX "activities_contractor_idx" ON "activities" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_contractor_for_a_contractor" CHECK ("duties"."contractor_id" is null or "duties"."performer" = 'contractor');--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contractor_for_a_contractor" CHECK ("activities"."contractor_id" is null or "activities"."performer" = 'contractor');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contractors" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("contractors"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("contractors"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "contractors" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "contractors"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "contractors"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The two rights for the tenants that are already there, as in 0046.
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
			('management', ARRAY['contractor.read', 'contractor.write']::text[]),
			('technical_management', ARRAY['contractor.read', 'contractor.write']::text[]),
			('site_management', ARRAY['contractor.read']::text[]),
			('technician', ARRAY['contractor.read']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
