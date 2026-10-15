-- A building with an area of its own (#306, section 2.8 of the concept,
-- ADR 0003, addendum of 15.10.2026).
--
-- Up to here the area of every row was the one of its property, kept by one
-- key per table over (tenant_id, property_id, area_id) with ON UPDATE CASCADE.
-- From here the area of a row is the one of what it hangs on, kept the same
-- way by a key onto that: a floor, a room, an asset and a time a building is
-- closed onto the building; what belongs to an asset onto the asset; what
-- belongs to an activity onto the activity; a decision onto its work order;
-- evidence onto its duty and a voiding onto its evidence; a print onto its
-- evidence or its activity; a deadline onto its source. The cascades run one
-- after the other: a property that moves takes the buildings along that have
-- no area of their own, those take their assets, the assets their meters.
--
-- **A building** has the area of its property until it is given one of its
-- own. `own_area_id` is that one or nothing, `area_id` the area it has either
-- way. Without one of its own, `area_from_property_id` names the property and
-- the key over it follows the area of the property; with one, the column is
-- empty and the key does not hold, because a key with an empty column is not
-- checked. Which property the building stands on is held by a key of its own
-- now.
--
-- **A row that can hang on the property itself or on something on it**
-- (duties, defects, activities, documents, tasks, labels, plans of rounds)
-- gets one key for each of the places it can name, each holding only where
-- its column is filled, and `area_from_property_id` for the property itself:
-- the property where none of the others is named, nothing where one is, held
-- by a check. The trigger `area_from_the_property` fills it before a row is
-- written, from the columns it is given as arguments, so that nothing that
-- writes such a row has to. It leads no area and takes nothing along; a table
-- without it fails at the check. PostgreSQL takes no key with ON UPDATE
-- CASCADE over a generated column ("invalid ON UPDATE action for foreign key
-- constraint containing generated column", PostgreSQL 18.6), so it is a
-- column of its own.
--
-- **The contacts** stay with the property, under the key they had.
--
-- **A label** given to an asset on site takes the area of the asset, so the
-- application may change `area_id` of a label as well.
--
-- **Whoever holds only the area of a building** sees the property it stands
-- on and the contacts there. `properties` and `contacts` trade `within_areas`
-- for four policies: `within_areas_or_a_building` for reading, which reads
-- like it and lets a row through besides whose property has a building the
-- person sees and that is not removed, and `within_areas_insert`, `_update`
-- and `_delete`, which write like it. One policy for every command would lend
-- what it lets be read to UPDATE as well, and whoever holds only a building
-- could move the property into their area with everything below it.
--
-- Everything is filled before a key or a check is added. Today every row has
-- the area of its property, so every new key holds for every row as it is,
-- and the column of the property is filled where a row hangs on nothing else.
-- Filling changes rows, so it runs as an UPDATE with `FORCE ROW LEVEL
-- SECURITY` lifted for its length (the owner of the tables runs a migration,
-- and none of their policies names the owner), and every row it changes gets
-- its entry in the log of its tenant with the reason `migration`.
--
-- Drizzle-kit wrote the statements of the schema, in two passes so that it
-- did not ask whether the new policy was the old one renamed; the order and
-- everything else is by hand.
--
-- **Fits the version before it.** That version writes no `own_area_id` and no
-- `area_from_property_id`; the trigger fills the second, and the area it
-- writes, the one of the property, is the one every key expects while no
-- building has an area of its own. It reads properties and contacts under a
-- policy that lets through what the old one did and more.
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "own_area_id" uuid;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "round_plans" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "labels" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "area_from_property_id" uuid;--> statement-breakpoint
ALTER TABLE "buildings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defects" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "labels" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "round_plans" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "buildings" SET "area_from_property_id" = "property_id";--> statement-breakpoint
UPDATE "duties" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("building_id", "room_id", "asset_id") = 0;--> statement-breakpoint
UPDATE "defects" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("building_id", "room_id", "asset_id") = 0;--> statement-breakpoint
UPDATE "activities" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("building_id", "room_id", "asset_id") = 0;--> statement-breakpoint
UPDATE "attachments" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("building_id", "room_id", "asset_id", "activity_id", "defect_id") = 0;--> statement-breakpoint
UPDATE "tasks" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("building_id", "room_id", "asset_id", "activity_id") = 0;--> statement-breakpoint
UPDATE "labels" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("asset_id", "room_id") = 0;--> statement-breakpoint
UPDATE "round_plans" SET "area_from_property_id" = "property_id" WHERE num_nonnulls("building_id") = 0;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "round_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A label of a sheet given to an asset on site takes the area of the asset,
-- which is not always the one of its property any more. The application may
-- change that column of a label as well; the key onto the asset holds it to
-- the area of the asset.
GRANT UPDATE ("area_id") ON "labels" TO "opengewerk_app";--> statement-breakpoint
CREATE FUNCTION "area_from_the_property"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	placed jsonb := to_jsonb(new);
	carrier text;
BEGIN
	-- The columns it is given are what a row may hang on besides its
	-- property; the first one that is filled leaves the column empty.
	FOREACH carrier IN ARRAY tg_argv LOOP
		IF placed ->> carrier IS NOT NULL THEN
			new.area_from_property_id := NULL;
			RETURN new;
		END IF;
	END LOOP;

	new.area_from_property_id := new.property_id;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "own_area_id" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('own_area_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "building_id", "room_id", "asset_id" ON "duties"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('building_id', 'room_id', 'asset_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "building_id", "room_id", "asset_id" ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('building_id', 'room_id', 'asset_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "building_id", "room_id", "asset_id" ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('building_id', 'room_id', 'asset_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "building_id", "room_id", "asset_id", "activity_id", "defect_id" ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('building_id', 'room_id', 'asset_id', 'activity_id', 'defect_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "building_id", "room_id", "asset_id", "activity_id" ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('building_id', 'room_id', 'asset_id', 'activity_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "asset_id", "room_id" ON "labels"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('asset_id', 'room_id');--> statement-breakpoint
CREATE TRIGGER "area_from_the_property" BEFORE INSERT OR UPDATE OF "property_id", "building_id" ON "round_plans"
	FOR EACH ROW EXECUTE FUNCTION "area_from_the_property"('building_id');--> statement-breakpoint
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_follow_their_property";--> statement-breakpoint
ALTER TABLE "floors" DROP CONSTRAINT "floors_follow_their_property";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_follow_their_property";--> statement-breakpoint
ALTER TABLE "building_closures" DROP CONSTRAINT "building_closures_follow_their_property";--> statement-breakpoint
ALTER TABLE "asset_lifecycle" DROP CONSTRAINT "asset_lifecycle_follows_its_property";--> statement-breakpoint
ALTER TABLE "asset_supplies" DROP CONSTRAINT "asset_supplies_follow_their_property";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_follow_their_property";--> statement-breakpoint
ALTER TABLE "meter_exchanges" DROP CONSTRAINT "meter_exchanges_follow_their_property";--> statement-breakpoint
ALTER TABLE "meter_pauses" DROP CONSTRAINT "meter_pauses_follow_their_property";--> statement-breakpoint
ALTER TABLE "meter_points" DROP CONSTRAINT "meter_points_follow_their_property";--> statement-breakpoint
ALTER TABLE "meter_readings" DROP CONSTRAINT "meter_readings_follow_their_property";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_follow_their_property";--> statement-breakpoint
ALTER TABLE "duty_dismissals" DROP CONSTRAINT "duty_dismissals_follow_their_property";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_follows_its_property";--> statement-breakpoint
ALTER TABLE "evidence_voidings" DROP CONSTRAINT "evidence_voidings_follow_their_property";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_follow_their_property";--> statement-breakpoint
ALTER TABLE "activity_duties" DROP CONSTRAINT "activity_duties_follow_their_property";--> statement-breakpoint
ALTER TABLE "work_order_notes" DROP CONSTRAINT "work_order_notes_follow_their_property";--> statement-breakpoint
ALTER TABLE "work_order_participants" DROP CONSTRAINT "work_order_participants_follow_their_property";--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_follow_their_property";--> statement-breakpoint
ALTER TABLE "activity_answers" DROP CONSTRAINT "activity_answers_follow_their_property";--> statement-breakpoint
ALTER TABLE "round_plans" DROP CONSTRAINT "round_plans_follow_their_property";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_follow_their_property";--> statement-breakpoint
ALTER TABLE "activity_signatures" DROP CONSTRAINT "activity_signatures_follow_their_property";--> statement-breakpoint
ALTER TABLE "work_order_decisions" DROP CONSTRAINT "work_order_decisions_follow_their_property";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_property";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_follow_their_property";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_follow_their_property";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_follow_their_property";--> statement-breakpoint
ALTER TABLE "round_records" DROP CONSTRAINT "round_records_follow_their_property";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_follow_their_property";--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_on_their_property" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_in_an_own_area_of_the_tenant" FOREIGN KEY ("tenant_id","own_area_id") REFERENCES "public"."areas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "building_closures" ADD CONSTRAINT "building_closures_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ADD CONSTRAINT "asset_lifecycle_follows_its_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "components_follow_their_asset" FOREIGN KEY ("tenant_id","parent_asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_exchanges" ADD CONSTRAINT "meter_exchanges_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_pauses" ADD CONSTRAINT "meter_pauses_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_follows_its_duty" FOREIGN KEY ("tenant_id","duty_id","area_id") REFERENCES "public"."duties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_follow_their_evidence" FOREIGN KEY ("tenant_id","evidence_id","area_id") REFERENCES "public"."evidence"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_follow_their_work_order" FOREIGN KEY ("tenant_id","work_order_id","area_id") REFERENCES "public"."work_orders"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_duty" FOREIGN KEY ("tenant_id","duty_id","area_id") REFERENCES "public"."duties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_defect" FOREIGN KEY ("tenant_id","defect_id","area_id") REFERENCES "public"."defects"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_plan" FOREIGN KEY ("tenant_id","round_plan_id","area_id") REFERENCES "public"."round_plans"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_meters_follow_their_property" FOREIGN KEY ("tenant_id","meter_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_defect" FOREIGN KEY ("tenant_id","defect_id","area_id") REFERENCES "public"."defects"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_follow_their_evidence" FOREIGN KEY ("tenant_id","evidence_id","area_id") REFERENCES "public"."evidence"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_room" FOREIGN KEY ("tenant_id","room_id","area_id") REFERENCES "public"."rooms"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_property" FOREIGN KEY ("tenant_id","area_from_property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_area_own_or_of_the_property" CHECK (("buildings"."own_area_id" is null) = ("buildings"."area_from_property_id" is not null) and ("buildings"."area_from_property_id" is null or "buildings"."area_from_property_id" = "buildings"."property_id") and ("buildings"."own_area_id" is null or "buildings"."own_area_id" = "buildings"."area_id"));--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_area_from_the_property" CHECK ("duties"."area_from_property_id" is not distinct from (case when num_nonnulls("duties"."building_id", "duties"."room_id", "duties"."asset_id") = 0 then "duties"."property_id" end));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_area_from_the_property" CHECK ("activities"."area_from_property_id" is not distinct from (case when num_nonnulls("activities"."building_id", "activities"."room_id", "activities"."asset_id") = 0 then "activities"."property_id" end));--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_area_from_the_property" CHECK ("round_plans"."area_from_property_id" is not distinct from (case when num_nonnulls("round_plans"."building_id") = 0 then "round_plans"."property_id" end));--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_area_from_the_property" CHECK ("defects"."area_from_property_id" is not distinct from (case when num_nonnulls("defects"."building_id", "defects"."room_id", "defects"."asset_id") = 0 then "defects"."property_id" end));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_area_from_the_property" CHECK ("attachments"."area_from_property_id" is not distinct from (case when num_nonnulls("attachments"."building_id", "attachments"."room_id", "attachments"."asset_id", "attachments"."activity_id", "attachments"."defect_id") = 0 then "attachments"."property_id" end));--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_area_from_the_property" CHECK ("labels"."area_from_property_id" is not distinct from (case when num_nonnulls("labels"."asset_id", "labels"."room_id") = 0 then "labels"."property_id" end));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_area_from_the_property" CHECK ("tasks"."area_from_property_id" is not distinct from (case when num_nonnulls("tasks"."building_id", "tasks"."room_id", "tasks"."asset_id", "tasks"."activity_id") = 0 then "tasks"."property_id" end));--> statement-breakpoint
CREATE POLICY "within_areas_or_a_building" ON "contacts" AS RESTRICTIVE FOR SELECT TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]) OR EXISTS (SELECT 1 FROM buildings WHERE buildings.tenant_id = contacts.tenant_id AND buildings.property_id = contacts.property_id AND buildings.deleted_at IS NULL));--> statement-breakpoint
CREATE POLICY "within_areas_or_a_building" ON "properties" AS RESTRICTIVE FOR SELECT TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]) OR EXISTS (SELECT 1 FROM buildings WHERE buildings.tenant_id = properties.tenant_id AND buildings.property_id = properties.id AND buildings.deleted_at IS NULL));--> statement-breakpoint
CREATE POLICY "within_areas_insert" ON "properties" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_areas_update" ON "properties" AS RESTRICTIVE FOR UPDATE TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_areas_delete" ON "properties" AS RESTRICTIVE FOR DELETE TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_areas_insert" ON "contacts" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_areas_update" ON "contacts" AS RESTRICTIVE FOR UPDATE TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_areas_delete" ON "contacts" AS RESTRICTIVE FOR DELETE TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
DROP POLICY "within_areas" ON "contacts" CASCADE;--> statement-breakpoint
DROP POLICY "within_areas" ON "properties" CASCADE;
