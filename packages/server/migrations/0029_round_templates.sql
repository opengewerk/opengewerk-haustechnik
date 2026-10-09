-- The templates of the rounds of an operator and their versions (#112,
-- sections 2.5 and 4.5 of the concept).
--
-- A template belongs to the operator and lies in no area, so its rows carry
-- the tenant and the policy `tenant_isolation`, nothing else. What its points
-- are about, assets, rooms and duties, lies in areas; whether the person sees
-- them is asked by the route, against the policies of those tables.
--
-- A version is never changed: the application role may insert one and read
-- it. A change to a template is the next version, and a round names the
-- version it began in. The template keeps the title of its newest version,
-- which the route writes with it. Nothing deletes either, so neither has
-- DELETE. Both travel to every device, to read.
--
-- Everything from the tables down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks these tables, and
-- nothing it writes is changed.
CREATE TABLE "round_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"form_version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"asks_countersignature" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "round_template_versions_once" UNIQUE("tenant_id","template_id","form_version"),
	CONSTRAINT "round_template_versions_counted" CHECK ("round_template_versions"."form_version" >= 1),
	CONSTRAINT "round_template_versions_definition_shaped" CHECK (jsonb_typeof("round_template_versions"."definition") = 'object' and char_length("round_template_versions"."definition"::text) <= 400000)
);
--> statement-breakpoint
ALTER TABLE "round_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "round_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_key" text,
	"source_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "round_templates_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "round_templates_title_shaped" CHECK ("round_templates"."title" = btrim("round_templates"."title") and char_length("round_templates"."title") between 1 and 120),
	CONSTRAINT "round_templates_source_shaped" CHECK (("round_templates"."source_key" is null) = ("round_templates"."source_version" is null) and ("round_templates"."source_key" is null or ("round_templates"."source_key" ~ '^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$' and char_length("round_templates"."source_key") <= 130 and "round_templates"."source_version" >= 1)))
);
--> statement-breakpoint
ALTER TABLE "round_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "round_template_versions" ADD CONSTRAINT "round_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_template_versions" ADD CONSTRAINT "round_template_versions_of_their_template" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."round_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_templates" ADD CONSTRAINT "round_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "round_template_versions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("round_template_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("round_template_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "round_templates" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("round_templates"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("round_templates"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "round_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "round_template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "round_templates" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "round_template_versions" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "round_templates"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "round_templates"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "round_template_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "round_template_versions"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
