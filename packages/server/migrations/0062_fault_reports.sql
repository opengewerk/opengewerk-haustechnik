-- The fault reports with an account (#331, section 4.7 of the concept).
--
-- `fault_categories`: the categories of an operator, which the first start
-- proposes and whoever changes settings keeps. They belong to the operator
-- and lie in no area: the policy `tenant_isolation` alone, FORCE, and no
-- DELETE for the application role, as a category is marked when it is removed.
--
-- `fault_reports`: a report in a building, at a room or an asset there, with
-- the area of its building over keys that follow it (ADR 0003), the policy
-- `within_areas`, FORCE, and no DELETE: a report is never removed. It names
-- who reported it, the work order accepting it made, the report it was merged
-- into in the same building, and the defect reported from it.
--
-- Two occasions of push (section 3 of the concept): a report received, to
-- whoever accepts faults in its area, and a report accepted or done, to whoever
-- reported it.
--
-- The rights "Störungen melden" (`fault.report`, all four roles) and
-- "Störungen annehmen" (`fault.accept`, Leitung, Technische Leitung and
-- Objektleitung), decided on 15.10.2026, for the tenants that are already
-- there, as in 0046; and the fifth shipped role, the Melder, as a row of every
-- tenant that has its roles already. A tenant without any is filled with all
-- five at the next start (`completeRoles`), so it gets none here.

ALTER TYPE "public"."push_kind" ADD VALUE 'fault_received' BEFORE 'test';--> statement-breakpoint
ALTER TYPE "public"."push_kind" ADD VALUE 'fault_answered' BEFORE 'test';--> statement-breakpoint
CREATE TABLE "fault_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fault_categories_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "fault_categories_name_shaped" CHECK ("fault_categories"."name" = btrim("fault_categories"."name") and char_length("fault_categories"."name") between 1 and 80),
	CONSTRAINT "fault_categories_position" CHECK ("fault_categories"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fault_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fault_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"room_id" uuid,
	"asset_id" uuid,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"photo_sha256" text,
	"reported_by" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"work_order_id" uuid,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"merged_into_id" uuid,
	"defect_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fault_reports_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "fault_reports_in_their_building" UNIQUE("tenant_id","id","property_id","building_id"),
	CONSTRAINT "fault_reports_room_or_asset" CHECK ("fault_reports"."room_id" is null or "fault_reports"."asset_id" is null),
	CONSTRAINT "fault_reports_description_shaped" CHECK ("fault_reports"."description" = btrim("fault_reports"."description") and char_length("fault_reports"."description") between 1 and 2000),
	CONSTRAINT "fault_reports_reason_shaped" CHECK ("fault_reports"."rejection_reason" is null or ("fault_reports"."rejection_reason" = btrim("fault_reports"."rejection_reason") and char_length("fault_reports"."rejection_reason") between 1 and 1000)),
	CONSTRAINT "fault_reports_rejected_with_a_reason" CHECK (("fault_reports"."rejected_at" is null) = ("fault_reports"."rejection_reason" is null)),
	CONSTRAINT "fault_reports_accepted_with_an_order" CHECK (("fault_reports"."work_order_id" is null) = ("fault_reports"."accepted_at" is null)),
	CONSTRAINT "fault_reports_not_into_itself" CHECK ("fault_reports"."merged_into_id" is null or "fault_reports"."merged_into_id" <> "fault_reports"."id"),
	CONSTRAINT "fault_reports_one_way_on" CHECK (num_nonnulls("fault_reports"."work_order_id", "fault_reports"."rejected_at", "fault_reports"."merged_into_id") <= 1),
	CONSTRAINT "fault_reports_photo_is_a_hash" CHECK ("fault_reports"."photo_sha256" is null or "fault_reports"."photo_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "fault_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fault_categories" ADD CONSTRAINT "fault_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_in_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_at_a_room_of_their_building" FOREIGN KEY ("tenant_id","room_id","building_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_at_an_asset_of_their_building" FOREIGN KEY ("tenant_id","asset_id","building_id","property_id") REFERENCES "public"."assets"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_of_a_category" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."fault_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_photo_stored" FOREIGN KEY ("tenant_id","photo_sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_reporter_works_here" FOREIGN KEY ("tenant_id","reported_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_accepted_as_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","work_order_id","property_id") REFERENCES "public"."work_orders"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_merged_in_their_building" FOREIGN KEY ("tenant_id","merged_into_id","property_id","building_id") REFERENCES "public"."fault_reports"("tenant_id","id","property_id","building_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_reports" ADD CONSTRAINT "fault_reports_reported_as_a_defect_of_their_property" FOREIGN KEY ("tenant_id","defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fault_categories_tenant_position_idx" ON "fault_categories" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "fault_reports_received_idx" ON "fault_reports" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "fault_reports_building_idx" ON "fault_reports" USING btree ("tenant_id","building_id");--> statement-breakpoint
CREATE INDEX "fault_reports_reporter_idx" ON "fault_reports" USING btree ("tenant_id","reported_by");--> statement-breakpoint
CREATE INDEX "fault_reports_work_order_idx" ON "fault_reports" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE INDEX "fault_reports_merged_into_idx" ON "fault_reports" USING btree ("tenant_id","merged_into_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fault_categories" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("fault_categories"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("fault_categories"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fault_reports" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("fault_reports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("fault_reports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "fault_reports" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "fault_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fault_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fault_categories" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fault_reports" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "fault_categories"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "fault_reports"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- The two rights for the roles that are already there, and the Melder as a
-- row of every tenant that has roles, as in 0046.
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
			('management', ARRAY['fault.report', 'fault.accept']::text[]),
			('technical_management', ARRAY['fault.report', 'fault.accept']::text[]),
			('site_management', ARRAY['fault.report', 'fault.accept']::text[]),
			('technician', ARRAY['fault.report']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
INSERT INTO "tenant_roles" ("tenant_id", "key", "label", "rights", "leads", "second_factor")
SELECT DISTINCT "held"."tenant_id", 'reporter', 'Melder', ARRAY['fault.report', 'sync.read', 'sync.write', 'push.write']::text[], false, false
  FROM "tenant_roles" AS "held"
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
