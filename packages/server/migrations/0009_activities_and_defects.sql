-- The activities and the defects of an operator (section 2.2 of the concept,
-- ADR 0002, points 13 and 15, opengewerk-haustechnik#26): what is done to meet
-- a due day or to set a fault right, and what is noticed on the way.
--
-- A round, an inspection, a maintenance and a work order are kinds of one
-- activity, in one table, so that each meets a duty the same way. The duties
-- an activity is to meet stand beside it, a duty once among them. What only a
-- work order has stands in a table of its own: its number from the sequence
-- of the work orders, drawn by the server, and its kind. A work order hangs on
-- an activity of the kind "work order", which the key holds with the kind of
-- the activity in it: a column that is always `work_order`, so that a work
-- order cannot hang on a round and an activity with a work order cannot
-- become one. A defect hangs on an asset or a place, names the activity it
-- was noticed in if there was one and the work order that sets it right once
-- there is one; its class is a key that no package names yet
-- (opengewerk-haustechnik#59).
--
-- Every row carries the property and the area of its place, kept by the key
-- over (tenant_id, property_id, area_id) with ON UPDATE CASCADE, and the
-- restrictive policy `within_areas` (ADR 0003). An activity and a defect hang
-- on the property and at most one of a building, a room or an asset there, as
-- a duty does, and every key between the rows runs over the tenant and the
-- property. The rows carry the columns of the sync; which device holds which,
-- and what a device may write, comes with the rules of the sync (#27).
-- Deleting marks a row: the application role has no DELETE, and a trigger
-- marks what hangs below a row that is marked, at the same moment.
--
-- Everything from the four types down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks these tables, and
-- creating them changes no row anywhere else.

CREATE TYPE "public"."activity_kind" AS ENUM('round', 'inspection', 'maintenance', 'work_order');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('open', 'started', 'signed', 'done', 'not_performed');--> statement-breakpoint
CREATE TYPE "public"."work_order_kind" AS ENUM('fault', 'defect_remedy', 'maintenance', 'inspection', 'other');--> statement-breakpoint
CREATE TYPE "public"."defect_status" AS ENUM('found', 'ordered', 'remedied', 'verified');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"asset_id" uuid,
	"kind" "activity_kind" NOT NULL,
	"title" text NOT NULL,
	"status" "activity_status" DEFAULT 'open' NOT NULL,
	"due_on" date,
	"responsible_user_id" text,
	"performer_user_id" text,
	"contractor_note" text,
	"closing_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "activities_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "activities_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "activities_kind_place" UNIQUE("tenant_id","id","property_id","kind"),
	CONSTRAINT "activities_one_target" CHECK (num_nonnulls("activities"."building_id", "activities"."room_id", "activities"."asset_id") <= 1),
	CONSTRAINT "activities_title_shaped" CHECK ("activities"."title" = btrim("activities"."title") and char_length("activities"."title") between 1 and 200),
	CONSTRAINT "activities_contractor_note_shaped" CHECK ("activities"."contractor_note" is null or ("activities"."contractor_note" = btrim("activities"."contractor_note") and char_length("activities"."contractor_note") between 1 and 200)),
	CONSTRAINT "activities_closing_reason_shaped" CHECK ("activities"."closing_reason" is null or ("activities"."closing_reason" = btrim("activities"."closing_reason") and char_length("activities"."closing_reason") between 1 and 500)),
	CONSTRAINT "activities_closed_with_a_reason" CHECK (("activities"."status" = 'not_performed') = ("activities"."closing_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_duties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"duty_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_duties_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "activity_duties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"activity_kind" "activity_kind" DEFAULT 'work_order' NOT NULL,
	"number" text,
	"kind" "work_order_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_orders_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_orders_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "work_orders_one_per_activity" UNIQUE("tenant_id","activity_id"),
	CONSTRAINT "work_orders_of_a_work_order" CHECK ("work_orders"."activity_kind" = 'work_order'),
	CONSTRAINT "work_orders_number_shaped" CHECK ("work_orders"."number" is null or ("work_orders"."number" = btrim("work_orders"."number") and char_length("work_orders"."number") between 1 and 40))
);
--> statement-breakpoint
ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"asset_id" uuid,
	"found_in_activity_id" uuid,
	"remedy_work_order_id" uuid,
	"description" text NOT NULL,
	"defect_class" text,
	"found_on" date NOT NULL,
	"due_on" date,
	"status" "defect_status" DEFAULT 'found' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "defects_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "defects_one_target" CHECK (num_nonnulls("defects"."building_id", "defects"."room_id", "defects"."asset_id") <= 1),
	CONSTRAINT "defects_description_shaped" CHECK ("defects"."description" = btrim("defects"."description") and char_length("defects"."description") between 1 and 1000),
	CONSTRAINT "defects_class_shaped" CHECK ("defects"."defect_class" is null or ("defects"."defect_class" = btrim("defects"."defect_class") and char_length("defects"."defect_class") between 1 and 130)),
	CONSTRAINT "defects_due_after_found" CHECK ("defects"."due_on" is null or "defects"."due_on" >= "defects"."found_on")
);
--> statement-breakpoint
ALTER TABLE "defects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_responsible_works_here" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_performer_works_here" FOREIGN KEY ("tenant_id","performer_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_of_a_duty_of_their_property" FOREIGN KEY ("tenant_id","duty_id","property_id") REFERENCES "public"."duties"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_found_in_an_activity_of_their_property" FOREIGN KEY ("tenant_id","found_in_activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_set_right_by_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","remedy_work_order_id","property_id") REFERENCES "public"."work_orders"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_property_idx" ON "activities" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "activities_asset_idx" ON "activities" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "activity_duties_duty_idx" ON "activity_duties" USING btree ("tenant_id","duty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_duties_once" ON "activity_duties" USING btree ("tenant_id","activity_id","duty_id") WHERE "activity_duties"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_number_once" ON "work_orders" USING btree ("tenant_id","number") WHERE "work_orders"."number" is not null;--> statement-breakpoint
CREATE INDEX "defects_property_idx" ON "defects" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "defects_asset_idx" ON "defects" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activities" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "activities" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activity_duties" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("activity_duties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("activity_duties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "activity_duties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_orders" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_orders"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_orders"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "work_orders" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "defects" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("defects"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("defects"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "defects" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "activities" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "activity_duties" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "work_orders" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "defects" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_duties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_orders"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "activity_duties"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_orders"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- What hangs below a marked row is marked with it, at the same moment: the
-- activities and defects of a marked property, building, room or asset, the
-- duties and the work order of a marked activity, and the links of a marked
-- duty to the activities that were to meet it. A defect stays when the
-- activity it was noticed in or the work order that sets it right is marked:
-- it is at its asset or its place and not in either of them. The levels below
-- a marked row mark theirs in turn, by the triggers of the place, the
-- technology and the duties. Only the step from live to deleted: nothing here
-- brings a row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: everything at a
-- row has its area, so whoever may mark the row sees it all. Every statement
-- names the tenant.
CREATE FUNCTION "mark_activities_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.activities SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
		UPDATE public.defects SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'buildings' THEN
		UPDATE public.activities SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
		UPDATE public.defects SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.activities SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
		UPDATE public.defects SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.activities SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
		UPDATE public.defects SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'activities' THEN
		UPDATE public.activity_duties SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND activity_id = new.id AND deleted_at IS NULL;
		UPDATE public.work_orders SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND activity_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'duties' THEN
		UPDATE public.activity_duties SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND duty_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activities_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_activities_below"();--> statement-breakpoint
CREATE TRIGGER "activities_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_activities_below"();--> statement-breakpoint
CREATE TRIGGER "activities_follow_deletion" AFTER UPDATE OF "deleted_at" ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "mark_activities_below"();--> statement-breakpoint
CREATE TRIGGER "activities_follow_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_activities_below"();--> statement-breakpoint
CREATE TRIGGER "activities_follow_deletion" AFTER UPDATE OF "deleted_at" ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "mark_activities_below"();--> statement-breakpoint
CREATE TRIGGER "activities_follow_deletion" AFTER UPDATE OF "deleted_at" ON "duties"
	FOR EACH ROW EXECUTE FUNCTION "mark_activities_below"();
