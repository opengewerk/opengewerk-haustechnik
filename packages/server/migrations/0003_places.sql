-- The place: properties, buildings, floors and rooms (section 2.2 of the
-- concept, ADR 0002, opengewerk-haustechnik#18).
--
-- Every level carries the ids of the levels above it, and composite keys hold
-- them together: a building stands on its property, a floor in its building,
-- a room on a floor of its own building (ADR 0002, point 2), and a room
-- always on a floor (point 3). Every level carries the area of its property
-- as well, kept by the key over (tenant_id, property_id, area_id) with ON
-- UPDATE CASCADE, and the restrictive policy `within_areas` of the building
-- block lets through the areas of the person asking (ADR 0003). The first
-- tables with a place: from here on the catalogue test of the areas has
-- something to hold.
--
-- The kinds of a building are an enum from the list in `domain`, several per
-- building: a school with an assembly hall is a meeting place as well. The
-- federal state of a property is an enum of the sixteen, written as ISO
-- 3166-2 like the scopes of the rule engine.
--
-- The rows will travel to a device and carry the columns of the sync, kept by
-- `stamp_sync_columns` like every travelling table of the foundation. Which
-- device holds which comes with the rules of the sync (#27); until then the
-- server hands none of them out. Deleting marks a row, never removes it: the
-- application role has no DELETE, and a trigger marks what hangs below a
-- marked row with the same moment, in the same statement.
--
-- Everything from the two types down to the policies is what drizzle-kit
-- generated from the schema, with one function in front of it: a check may
-- not ask a sub-select, and the one that holds each kind of a building once
-- counts in `each_once`, which has to exist before the table that asks it.
-- What follows the policies is written by hand: FORCE, the grants, the
-- triggers of the audit log and of the sync, and the marking of what hangs
-- below.
--
-- **Fits the version before it.** That version never asks these tables, and
-- no row of another table changes.

-- Whether every element of an array stands in it once. IMMUTABLE, so that a
-- check may ask it.
CREATE FUNCTION "each_once"(items anyarray) RETURNS boolean
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT cardinality(items) = (SELECT count(DISTINCT item) FROM unnest(items) AS item)
$$;--> statement-breakpoint
CREATE TYPE "public"."building_kind" AS ENUM('residential', 'high_rise', 'retail', 'commercial', 'office', 'school', 'care', 'assembly', 'hospital', 'accommodation', 'restaurant', 'detention', 'garage', 'outdoor', 'other');--> statement-breakpoint
CREATE TYPE "public"."federal_state" AS ENUM('DE-SH', 'DE-HH', 'DE-NI', 'DE-HB', 'DE-NW', 'DE-HE', 'DE-RP', 'DE-BW', 'DE-BY', 'DE-SL', 'DE-BE', 'DE-BB', 'DE-MV', 'DE-SN', 'DE-ST', 'DE-TH');--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_code" text,
	"kinds" "building_kind"[] NOT NULL,
	"year_built" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "buildings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "buildings_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "buildings_name_shaped" CHECK ("buildings"."name" = btrim("buildings"."name") and char_length("buildings"."name") between 1 and 120),
	CONSTRAINT "buildings_short_code_shaped" CHECK ("buildings"."short_code" is null or ("buildings"."short_code" = btrim("buildings"."short_code") and char_length("buildings"."short_code") between 1 and 20)),
	CONSTRAINT "buildings_kinds_shaped" CHECK (cardinality("buildings"."kinds") >= 1 and each_once("buildings"."kinds")),
	CONSTRAINT "buildings_year_built_shaped" CHECK ("buildings"."year_built" is null or "buildings"."year_built" between 1000 and 2100)
);
--> statement-breakpoint
ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "floors_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "floors_place" UNIQUE("tenant_id","id","building_id","property_id"),
	CONSTRAINT "floors_name_shaped" CHECK ("floors"."name" = btrim("floors"."name") and char_length("floors"."name") between 1 and 60),
	CONSTRAINT "floors_level_shaped" CHECK ("floors"."level" between -20 and 200)
);
--> statement-breakpoint
ALTER TABLE "floors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"federal_state" "federal_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "properties_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "properties_place" UNIQUE("tenant_id","id","area_id"),
	CONSTRAINT "properties_name_shaped" CHECK ("properties"."name" = btrim("properties"."name") and char_length("properties"."name") between 1 and 120),
	CONSTRAINT "properties_street_shaped" CHECK ("properties"."street" = btrim("properties"."street") and char_length("properties"."street") between 1 and 120),
	CONSTRAINT "properties_city_shaped" CHECK ("properties"."city" = btrim("properties"."city") and char_length("properties"."city") between 1 and 80),
	CONSTRAINT "properties_postal_code_shaped" CHECK ("properties"."postal_code" ~ '^[0-9]{5}$')
);
--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"number" text,
	"name" text,
	"use" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "rooms_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "rooms_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "rooms_number_shaped" CHECK ("rooms"."number" is null or ("rooms"."number" = btrim("rooms"."number") and char_length("rooms"."number") between 1 and 30)),
	CONSTRAINT "rooms_name_shaped" CHECK ("rooms"."name" is null or ("rooms"."name" = btrim("rooms"."name") and char_length("rooms"."name") between 1 and 120)),
	CONSTRAINT "rooms_use_shaped" CHECK ("rooms"."use" is null or ("rooms"."use" = btrim("rooms"."use") and char_length("rooms"."use") between 1 and 120)),
	CONSTRAINT "rooms_named" CHECK ("rooms"."number" is not null or "rooms"."name" is not null)
);
--> statement-breakpoint
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_in_their_building" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_in_an_area_of_the_tenant" FOREIGN KEY ("tenant_id","area_id") REFERENCES "public"."areas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_on_a_floor_of_their_building" FOREIGN KEY ("tenant_id","floor_id","building_id","property_id") REFERENCES "public"."floors"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "buildings_property_idx" ON "buildings" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "floors_building_idx" ON "floors" USING btree ("tenant_id","building_id");--> statement-breakpoint
CREATE INDEX "rooms_floor_idx" ON "rooms" USING btree ("tenant_id","floor_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "buildings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("buildings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("buildings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "buildings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "floors" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("floors"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("floors"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "floors" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "properties" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("properties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("properties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "properties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rooms" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("rooms"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("rooms"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "rooms" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "floors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "properties" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "buildings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "floors" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rooms" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "floors"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "floors"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- What hangs below a place that is marked deleted is marked with it, at the
-- same moment: the buildings of a property, the floors of a building and the
-- rooms of a floor. Each level marks the one below, and its own trigger the
-- next, so a property takes everything down to its rooms. Only the step from
-- live to deleted: nothing here brings a row back.
--
-- Not SECURITY DEFINER: it runs as whoever marks the row, under the policies.
-- Everything below a place has the area of that place, so whoever may mark it
-- sees everything below it. Every statement names the tenant, so that the
-- rule holds even where FORCE would be lifted.
CREATE FUNCTION "mark_places_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.buildings SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'buildings' THEN
		UPDATE public.floors SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'floors' THEN
		UPDATE public.rooms SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND floor_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "places_below_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_places_below"();--> statement-breakpoint
CREATE TRIGGER "places_below_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_places_below"();--> statement-breakpoint
CREATE TRIGGER "places_below_follow_deletion" AFTER UPDATE OF "deleted_at" ON "floors"
	FOR EACH ROW EXECUTE FUNCTION "mark_places_below"();
