-- Rolling the moves of buildings back to how 0051 left the database.
--
-- Nothing is moved. The keys that follow what a row hangs on are given
-- again without ON UPDATE CASCADE, as they were; every row holds them as it
-- holds the new ones.
CREATE OR REPLACE FUNCTION "asset_stays_on_its_property"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.property_id <> old.property_id THEN
		RAISE EXCEPTION 'Eine Anlage bleibt auf ihrer Liegenschaft; an einem anderen Ort ist sie eine neue Anlage.'
			USING ERRCODE = 'HT002';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_at_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_at_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_at_a_room_of_their_property";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_at_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "round_records" DROP CONSTRAINT "round_records_of_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_of_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_of_an_evidence_of_their_property";
--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_on_a_room_of_their_property";
--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_on_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_on_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_on_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_defect_of_their_property";
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_defect_of_their_property" FOREIGN KEY ("tenant_id","defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_room_of_their_property";
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_plan_of_their_property";
--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_plan_of_their_property" FOREIGN KEY ("tenant_id","round_plan_id","property_id") REFERENCES "public"."round_plans"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_defect_of_their_property";
--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_defect_of_their_property" FOREIGN KEY ("tenant_id","defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_duty_of_their_property";
--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_duty_of_their_property" FOREIGN KEY ("tenant_id","duty_id","property_id") REFERENCES "public"."duties"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_order_decisions" DROP CONSTRAINT "work_order_decisions_of_a_work_order_of_their_property";
--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","work_order_id","property_id") REFERENCES "public"."work_orders"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_signatures" DROP CONSTRAINT "activity_signatures_of_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_at_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_at_a_room_of_their_property";
--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_at_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_at_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_answers" DROP CONSTRAINT "activity_answers_of_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_of_a_work_order_of_their_property";
--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_order_participants" DROP CONSTRAINT "work_order_participants_of_a_work_order_of_their_property";
--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_order_notes" DROP CONSTRAINT "work_order_notes_of_a_work_order_of_their_property";
--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_duties" DROP CONSTRAINT "activity_duties_of_an_activity_of_their_property";
--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_at_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_at_a_room_of_their_property";
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_at_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evidence_voidings" DROP CONSTRAINT "evidence_voidings_of_an_evidence_of_their_property";
--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_of_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_of_a_duty_of_its_property";
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_of_a_duty_of_its_property" FOREIGN KEY ("tenant_id","duty_id","property_id") REFERENCES "public"."duties"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "duty_dismissals" DROP CONSTRAINT "duty_dismissals_of_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_at_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_at_a_room_of_their_property";
--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_at_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meter_readings" DROP CONSTRAINT "meter_readings_of_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meter_points" DROP CONSTRAINT "meter_points_of_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meter_pauses" DROP CONSTRAINT "meter_pauses_of_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "meter_pauses" ADD CONSTRAINT "meter_pauses_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meter_exchanges" DROP CONSTRAINT "meter_exchanges_of_an_asset_of_their_property";
--> statement-breakpoint
ALTER TABLE "meter_exchanges" ADD CONSTRAINT "meter_exchanges_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_in_a_room_of_their_building";
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_in_a_room_of_their_building" FOREIGN KEY ("tenant_id","room_id","building_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_in_a_building_of_their_property";
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_in_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "asset_supplies" DROP CONSTRAINT "asset_supplies_of_an_asset";
--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_of_an_asset" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "asset_lifecycle" DROP CONSTRAINT "asset_lifecycle_of_an_asset";
--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ADD CONSTRAINT "asset_lifecycle_of_an_asset" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "building_closures" DROP CONSTRAINT "building_closures_of_their_building";
--> statement-breakpoint
ALTER TABLE "building_closures" ADD CONSTRAINT "building_closures_of_their_building" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_on_a_floor_of_their_building";
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_on_a_floor_of_their_building" FOREIGN KEY ("tenant_id","floor_id","building_id","property_id") REFERENCES "public"."floors"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "floors" DROP CONSTRAINT "floors_in_their_building";
--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_in_their_building" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;
