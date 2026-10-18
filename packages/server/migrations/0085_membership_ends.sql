-- The end of an access (#356, sections 2.4 and 9 of the concept, decided
-- 15.10.2026): the last day stands on the membership since 0069; after it the
-- access ends by itself. What comes now:
--
-- `membership_settings`: how many days after the last day the data of an
-- access goes, one row per operator that set it; without one the
-- application counts its standard. `membership_removals`: when it went, once
-- per access, and whether the account went with it because it worked
-- nowhere else. Both tenant-wide and without an area: the policy
-- `tenant_isolation` alone, FORCE. A removal is written once and never
-- changed or removed: the application may read and add a row, nothing else.
--
-- `deadlines.member_user_id`: the end of an access and the day its data goes,
-- without a place like a contract. The key onto the deadlines and the
-- memberships, which both have rows, is laid while they are not under FORCE,
-- as 0067 does it (#315).
--
-- Nothing is written and no row is touched. A version of the application from
-- before this one reads the rows as before and leaves the column alone.

CREATE TABLE "membership_removals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_removed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_removals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"removal_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_settings_once" UNIQUE("tenant_id"),
	CONSTRAINT "membership_settings_removal_days_shaped" CHECK ("membership_settings"."removal_days" between 1 and 3650)
);
--> statement-breakpoint
ALTER TABLE "membership_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "member_user_id" text;--> statement-breakpoint
ALTER TABLE "membership_removals" ADD CONSTRAINT "membership_removals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_removals" ADD CONSTRAINT "membership_removals_of_somebody_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_settings" ADD CONSTRAINT "membership_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_removals_once" ON "membership_removals" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_an_access" FOREIGN KEY ("tenant_id","member_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deadlines_member_idx" ON "deadlines" USING btree ("tenant_id","member_user_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null or "deadlines"."delegation_id" is not null or "deadlines"."qualification_id" is not null or "deadlines"."member_user_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null) and ("deadlines"."delegation_id" is null or "deadlines"."property_id" is null) and ("deadlines"."qualification_id" is null or "deadlines"."property_id" is null) and ("deadlines"."member_user_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id", "deadlines"."evidence_id", "deadlines"."member_user_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_removals" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("membership_removals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("membership_removals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("membership_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("membership_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "membership_removals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A removal is written once, by the pass of the deadlines, and stays.
GRANT SELECT, INSERT ON "membership_removals" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "membership_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "membership_removals"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "membership_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
