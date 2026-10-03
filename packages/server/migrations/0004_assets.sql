-- The technology: assets, their components, their life cycle and what they
-- supply (section 2.2 of the concept, ADR 0002, points 4 to 9,
-- opengewerk-haustechnik#20).
--
-- An asset stands in exactly one building and on request in a room of that
-- building, which the key over (tenant_id, room_id, building_id, property_id)
-- holds against the new key `rooms_in_their_building`. A component is an
-- asset under an asset, in the same table, in the building of its asset, and
-- moves with it: the key over the parent cascades a move to every component,
-- at any depth. That no asset hangs under itself, a check sees in the row and
-- a trigger sees up the chain. An asset stays on its property: elsewhere, in
-- another federal state perhaps, it is a new asset with other duties, and a
-- trigger refuses the change. Every row carries the property and the area of
-- its asset, kept by the key over (tenant_id, property_id, area_id) with ON
-- UPDATE CASCADE, and the restrictive policy `within_areas` (ADR 0003).
--
-- The kind of an asset is a key of the catalogue, which is no table: whoever
-- writes the row asks the catalogue. The values of the characteristics and
-- fields of the kind stand in one JSON column (ADR 0002, point 6). A meter is
-- an asset of a kind that is a measuring point and carries its number and its
-- unit (point 9). The number of an asset is drawn by the server and is unique
-- in its tenant; drawn once, it is never handed out again (point 8).
--
-- The rows will travel to a device and carry the columns of the sync. Which
-- device holds which comes with the rules of the sync (#27). Deleting marks a
-- row: the application role has no DELETE, and a trigger marks what hangs
-- below at the same moment, the components, the life cycle and the supplies
-- of an asset, and the assets of a building or a room that is marked.
--
-- Everything from the two types down to the policies is what drizzle-kit
-- generated from the schema, with one line moved forward: the key of a room
-- in its building has to exist before the key of an asset that points at it.
-- What follows the policies is written by hand. The two triggers that refuse
-- raise error classes of this application, HT001 and HT002, so that their
-- sentence reaches whoever asked (`database-errors.ts`).
--
-- **Fits the version before it.** That version never asks these tables, and
-- the one new key on `rooms` changes no row and refuses none: the id of a room
-- is unique already.

CREATE TYPE "public"."lifecycle_state" AS ENUM('planned', 'in_service', 'out_of_service', 'decommissioned', 'removed');--> statement-breakpoint
CREATE TYPE "public"."meter_unit" AS ENUM('kilowatt_hours', 'megawatt_hours', 'cubic_metres');--> statement-breakpoint
CREATE TABLE "asset_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"state" "lifecycle_state" NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_lifecycle_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "asset_supplies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_supplies_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "asset_supplies_one_place" CHECK (("asset_supplies"."building_id" is null) <> ("asset_supplies"."room_id" is null))
);
--> statement-breakpoint
ALTER TABLE "asset_supplies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"room_id" uuid,
	"parent_asset_id" uuid,
	"kind" text NOT NULL,
	"number" text,
	"name" text NOT NULL,
	"mark" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"year_built" integer,
	"commissioned_on" date,
	"warranty_ends_on" date,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meter_number" text,
	"meter_unit" "meter_unit",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "assets_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "assets_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "assets_in_their_building" UNIQUE("tenant_id","id","building_id","property_id"),
	CONSTRAINT "assets_kind_shaped" CHECK ("assets"."kind" = btrim("assets"."kind") and char_length("assets"."kind") between 1 and 130),
	CONSTRAINT "assets_name_shaped" CHECK ("assets"."name" = btrim("assets"."name") and char_length("assets"."name") between 1 and 120),
	CONSTRAINT "assets_number_shaped" CHECK ("assets"."number" is null or ("assets"."number" = btrim("assets"."number") and char_length("assets"."number") between 1 and 40)),
	CONSTRAINT "assets_mark_shaped" CHECK ("assets"."mark" is null or ("assets"."mark" = btrim("assets"."mark") and char_length("assets"."mark") between 1 and 60)),
	CONSTRAINT "assets_manufacturer_shaped" CHECK ("assets"."manufacturer" is null or ("assets"."manufacturer" = btrim("assets"."manufacturer") and char_length("assets"."manufacturer") between 1 and 120)),
	CONSTRAINT "assets_model_shaped" CHECK ("assets"."model" is null or ("assets"."model" = btrim("assets"."model") and char_length("assets"."model") between 1 and 120)),
	CONSTRAINT "assets_serial_number_shaped" CHECK ("assets"."serial_number" is null or ("assets"."serial_number" = btrim("assets"."serial_number") and char_length("assets"."serial_number") between 1 and 80)),
	CONSTRAINT "assets_meter_number_shaped" CHECK ("assets"."meter_number" is null or ("assets"."meter_number" = btrim("assets"."meter_number") and char_length("assets"."meter_number") between 1 and 60)),
	CONSTRAINT "assets_year_built_shaped" CHECK ("assets"."year_built" is null or "assets"."year_built" between 1800 and 2100),
	CONSTRAINT "assets_values_shaped" CHECK (jsonb_typeof("assets"."values") = 'object'),
	CONSTRAINT "assets_meter_whole" CHECK (("assets"."meter_number" is null) = ("assets"."meter_unit" is null)),
	CONSTRAINT "assets_not_their_own_component" CHECK ("assets"."parent_asset_id" is distinct from "assets"."id")
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_in_their_building" UNIQUE("tenant_id","id","building_id","property_id");--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ADD CONSTRAINT "asset_lifecycle_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ADD CONSTRAINT "asset_lifecycle_of_an_asset" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_lifecycle" ADD CONSTRAINT "asset_lifecycle_follows_its_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_of_an_asset" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_to_a_building_of_its_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_supplies" ADD CONSTRAINT "asset_supplies_to_a_room_of_its_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_in_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_in_a_room_of_their_building" FOREIGN KEY ("tenant_id","room_id","building_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "components_in_the_building_of_their_asset" FOREIGN KEY ("tenant_id","parent_asset_id","building_id","property_id") REFERENCES "public"."assets"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "asset_lifecycle_asset_idx" ON "asset_lifecycle" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_lifecycle_one_state_a_day" ON "asset_lifecycle" USING btree ("tenant_id","asset_id","valid_from") WHERE "asset_lifecycle"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "asset_supplies_asset_idx" ON "asset_supplies" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_supplies_building_once" ON "asset_supplies" USING btree ("tenant_id","asset_id","building_id") WHERE "asset_supplies"."building_id" is not null and "asset_supplies"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_supplies_room_once" ON "asset_supplies" USING btree ("tenant_id","asset_id","room_id") WHERE "asset_supplies"."room_id" is not null and "asset_supplies"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assets_building_idx" ON "assets" USING btree ("tenant_id","building_id");--> statement-breakpoint
CREATE INDEX "assets_parent_idx" ON "assets" USING btree ("tenant_id","parent_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_number_once" ON "assets" USING btree ("tenant_id","number") WHERE "assets"."number" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "asset_lifecycle" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("asset_lifecycle"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("asset_lifecycle"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "asset_lifecycle" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "asset_supplies" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("asset_supplies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("asset_supplies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "asset_supplies" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "assets" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("assets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("assets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "assets" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_lifecycle" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_supplies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "assets" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_lifecycle" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_supplies" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "asset_lifecycle"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "asset_supplies"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "asset_lifecycle"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "asset_supplies"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No asset hangs under itself, however long the chain (ADR 0002, point 5).
-- This walks up from the new parent and refuses when it arrives at the row;
-- for a row that is there it comes before the check and refuses the shortest
-- circle too. A row that names itself when it is made it cannot see, because
-- the walk starts at a parent that is not there yet, and the key would be
-- content with the row itself: that one the check `assets_not_their_own_component`
-- refuses. UNION and not UNION ALL, so that a circle somebody made before
-- would end the walk instead of running it forever.
--
-- Not SECURITY DEFINER: the chain stands in one building, so in one area, and
-- whoever may write the row sees all of it.
CREATE FUNCTION "asset_hangs_not_under_itself"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.parent_asset_id IS NULL THEN
		RETURN new;
	END IF;

	IF EXISTS (
		WITH RECURSIVE up (id, parent_asset_id) AS (
			SELECT id, parent_asset_id FROM public.assets
			 WHERE tenant_id = new.tenant_id AND id = new.parent_asset_id
			UNION
			SELECT assets.id, assets.parent_asset_id FROM public.assets
			  JOIN up ON assets.id = up.parent_asset_id
			 WHERE assets.tenant_id = new.tenant_id
		)
		SELECT 1 FROM up WHERE id = new.id
	) THEN
		RAISE EXCEPTION 'Eine Komponente hängt nicht unter sich selbst.'
			USING ERRCODE = 'HT001';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "assets_hang_not_under_themselves" BEFORE INSERT OR UPDATE OF "parent_asset_id" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "asset_hangs_not_under_itself"();--> statement-breakpoint

-- An asset stays on its property. Moving it to another building there is
-- care of the asset; on another property, in another federal state perhaps,
-- it is a new asset with other duties, and its supplies and life cycle would
-- name a place it no longer belongs to.
CREATE FUNCTION "asset_stays_on_its_property"() RETURNS trigger
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
CREATE TRIGGER "assets_stay_on_their_property" BEFORE UPDATE OF "property_id" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "asset_stays_on_its_property"();--> statement-breakpoint

-- What hangs below a marked row is marked with it, at the same moment: the
-- assets of a building or a room, the supplies to it, and of an asset its
-- components, its life cycle and its supplies. The components mark theirs in
-- turn, by the same trigger. Only the step from live to deleted: nothing here
-- brings a row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: everything
-- below a row has its area, so whoever may mark the row sees it all. Every
-- statement names the tenant.
CREATE FUNCTION "mark_assets_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'buildings' THEN
		UPDATE public.assets SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
		UPDATE public.asset_supplies SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.assets SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
		UPDATE public.asset_supplies SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.assets SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND parent_asset_id = new.id AND deleted_at IS NULL;
		UPDATE public.asset_lifecycle SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
		UPDATE public.asset_supplies SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "assets_below_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_assets_below"();--> statement-breakpoint
CREATE TRIGGER "assets_below_follow_deletion" AFTER UPDATE OF "deleted_at" ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "mark_assets_below"();--> statement-breakpoint
CREATE TRIGGER "assets_below_follow_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_assets_below"();
