-- Rolling the areas of buildings back to how 0050 left the database.
--
-- What it costs an installation that runs it: every building with an area of
-- its own goes back to the area of its property, and everything in it with
-- it. Whoever holds only that area no longer sees the building, and no longer
-- the property it stands on either.
--
-- The buildings are given the area of their property first, while the keys of
-- 0051 still stand: their cascades take every row in such a building along,
-- and every changed row gets its entry in the log of its tenant with the
-- reason `migration`. The statement reads `properties` and writes
-- `buildings`, so `FORCE ROW LEVEL SECURITY` is lifted on both for its length,
-- inside the transaction a rollback runs in. Then the keys, checks, triggers
-- and columns of 0051 go, and the keys of 0050 come back; every row has the
-- area of its property again, so each of them holds.

ALTER TABLE "properties" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buildings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "buildings" AS "building"
   SET "own_area_id" = NULL, "area_id" = "property"."area_id"
  FROM "properties" AS "property"
 WHERE "property"."id" = "building"."property_id" AND "building"."own_area_id" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "within_areas_or_a_building" ON "properties";--> statement-breakpoint
DROP POLICY "within_areas_insert" ON "properties";--> statement-breakpoint
DROP POLICY "within_areas_update" ON "properties";--> statement-breakpoint
DROP POLICY "within_areas_delete" ON "properties";--> statement-breakpoint
CREATE POLICY "within_areas" ON "properties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
DROP POLICY "within_areas_or_a_building" ON "contacts";--> statement-breakpoint
DROP POLICY "within_areas_insert" ON "contacts";--> statement-breakpoint
DROP POLICY "within_areas_update" ON "contacts";--> statement-breakpoint
DROP POLICY "within_areas_delete" ON "contacts";--> statement-breakpoint
CREATE POLICY "within_areas" ON "contacts" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
DROP TRIGGER "buildings_on_a_property_in_reach" ON "buildings";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "buildings";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "duties";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "defects";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "activities";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "attachments";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "tasks";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "labels";--> statement-breakpoint
DROP TRIGGER "area_from_the_property" ON "round_plans";--> statement-breakpoint
DROP FUNCTION "building_on_a_property_in_reach"();--> statement-breakpoint
DROP FUNCTION "area_from_the_property"();--> statement-breakpoint
REVOKE UPDATE ("area_id") ON "labels" FROM "opengewerk_app";--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_area_own_or_of_the_property";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_area_from_the_property";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_area_from_the_property";--> statement-breakpoint
ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_area_from_the_property";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_area_from_the_property";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_area_from_the_property";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_area_from_the_property";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_area_from_the_property";--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_on_their_property";--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_in_an_own_area_of_the_tenant";--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_follow_their_property";--> statement-breakpoint
ALTER TABLE "floors" DROP CONSTRAINT "floors_follow_their_building";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_follow_their_building";--> statement-breakpoint
ALTER TABLE "building_closures" DROP CONSTRAINT "building_closures_follow_their_building";--> statement-breakpoint
ALTER TABLE "asset_lifecycle" DROP CONSTRAINT "asset_lifecycle_follows_its_asset";--> statement-breakpoint
ALTER TABLE "asset_supplies" DROP CONSTRAINT "asset_supplies_follow_their_asset";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_follow_their_building";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "components_follow_their_asset";--> statement-breakpoint
ALTER TABLE "meter_exchanges" DROP CONSTRAINT "meter_exchanges_follow_their_asset";--> statement-breakpoint
ALTER TABLE "meter_pauses" DROP CONSTRAINT "meter_pauses_follow_their_asset";--> statement-breakpoint
ALTER TABLE "meter_points" DROP CONSTRAINT "meter_points_follow_their_asset";--> statement-breakpoint
ALTER TABLE "meter_readings" DROP CONSTRAINT "meter_readings_follow_their_asset";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_follow_their_building";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_follow_their_room";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_follow_their_asset";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_follow_their_property";--> statement-breakpoint
ALTER TABLE "duty_dismissals" DROP CONSTRAINT "duty_dismissals_follow_their_asset";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_follows_its_duty";--> statement-breakpoint
ALTER TABLE "evidence_voidings" DROP CONSTRAINT "evidence_voidings_follow_their_evidence";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_follow_their_building";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_follow_their_room";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_follow_their_asset";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_follow_their_property";--> statement-breakpoint
ALTER TABLE "activity_duties" DROP CONSTRAINT "activity_duties_follow_their_activity";--> statement-breakpoint
ALTER TABLE "work_order_notes" DROP CONSTRAINT "work_order_notes_follow_their_activity";--> statement-breakpoint
ALTER TABLE "work_order_participants" DROP CONSTRAINT "work_order_participants_follow_their_activity";--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_follow_their_activity";--> statement-breakpoint
ALTER TABLE "activity_answers" DROP CONSTRAINT "activity_answers_follow_their_activity";--> statement-breakpoint
ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_follow_their_building";--> statement-breakpoint
ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_follow_their_property";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_follow_their_building";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_follow_their_room";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_follow_their_asset";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_follow_their_property";--> statement-breakpoint
ALTER TABLE "activity_signatures" DROP CONSTRAINT "activity_signatures_follow_their_activity";--> statement-breakpoint
ALTER TABLE "work_order_decisions" DROP CONSTRAINT "work_order_decisions_follow_their_work_order";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_duty";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_defect";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_plan";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_meters_follow_their_property";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_building";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_room";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_asset";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_activity";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_defect";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_property";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_follow_their_asset";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_follow_their_room";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_follow_their_property";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_follow_their_evidence";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_follow_their_activity";--> statement-breakpoint
ALTER TABLE "round_records" DROP CONSTRAINT "round_records_follow_their_activity";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_follow_their_building";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_follow_their_room";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_follow_their_asset";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_follow_their_activity";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_follow_their_property";--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_area_key";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_area_key";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_area_key";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_area_key";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_area_key";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_area_key";--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_area_key";--> statement-breakpoint
ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_area_key";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_area_key";--> statement-breakpoint
ALTER TABLE "buildings" DROP COLUMN "own_area_id";--> statement-breakpoint
ALTER TABLE "buildings" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "round_plans" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "labels" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "area_from_property_id";--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "building_closures" ADD CONSTRAINT "building_closures_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ADD CONSTRAINT "asset_lifecycle_follows_its_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_exchanges" ADD CONSTRAINT "meter_exchanges_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_pauses" ADD CONSTRAINT "meter_pauses_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_follows_its_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;
