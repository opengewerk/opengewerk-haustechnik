-- The electrical structure below a low-voltage installation (#349, section
-- 4.2 of the concept, decision 31 of phase 2): boards, their sections, the
-- circuits with protective device, RCD and cable, and the equipment on a
-- circuit. The tables are the foundation's (`electricalSchema`, ADR 0014 in
-- the repository opengewerk), under the names the trades application gives
-- them, with what this application gives every row with a place: the asset,
-- its property and its area, kept by the keys onto the asset with ON UPDATE
-- CASCADE, and the restrictive policies `within_areas` and `within_limits`
-- (ADR 0003, #339). A board hangs on its asset; a section, a circuit and a
-- piece of equipment carry the same asset, which the keys over tenant, parent
-- and asset hold, so that a part never lies in another area than its board.
--
-- Everything from the types down to the policies is what drizzle-kit
-- generated from the schema, with one change: the key from a circuit to its
-- section empties only the section when one is removed, `SET NULL
-- ("board_section_id")`, and leaves the circuit on its board. Without the
-- column list PostgreSQL empties the board as well, which `not null` refuses,
-- the lesson of 0030 in the trades application. What follows the policies is
-- written by hand:
--
-- **Rights.** The application reads, adds and changes the rows and deletes
-- none: a part is marked, like every record that travels.
--
-- **Marked as deleted, all the way down.** An asset that is marked takes its
-- boards along, a board its sections and circuits, a section its circuits
-- and a circuit its equipment, in the same statement and with the same
-- moment, so that the change stream and the log carry each row. Rows are
-- marked and not removed, so the cascades of the keys never run.
--
-- **Only under a low-voltage installation.** A board hangs on an asset of the
-- kind `elektro.low_voltage_installation`, and such an asset with boards
-- keeps its kind; a trigger refuses anything else with the error class
-- HT014. The sync asks the same before, as a conflict about the one board.
--
-- No right is new: the structure is read, taken stock of and kept with the
-- rights of the assets.
--
-- **Fits the version before it.** That version knows none of the tables.
CREATE TYPE "public"."cable_installation_method" AS ENUM('a1', 'a2', 'b1', 'b2', 'c', 'd1', 'd2', 'e', 'f', 'g');--> statement-breakpoint
CREATE TYPE "public"."distribution_board_kind" AS ENUM('main_distribution', 'sub_distribution');--> statement-breakpoint
CREATE TYPE "public"."overcurrent_device" AS ENUM('circuit_breaker', 'rcbo', 'fuse_d', 'fuse_d0', 'fuse_nh');--> statement-breakpoint
CREATE TYPE "public"."rcd_type" AS ENUM('ac', 'a', 'a_ev', 'f', 'b', 'b_plus');--> statement-breakpoint
CREATE TYPE "public"."trip_characteristic" AS ENUM('b', 'c', 'd', 'k', 'z', 'gg', 'am');--> statement-breakpoint
CREATE TABLE "board_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"distribution_board_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"asset_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "board_sections_id_board_key" UNIQUE("id","distribution_board_id")
);
--> statement-breakpoint
ALTER TABLE "board_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "circuits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"distribution_board_id" uuid NOT NULL,
	"board_section_id" uuid,
	"designation" text NOT NULL,
	"consumer" text,
	"overcurrent_device" "overcurrent_device",
	"trip_characteristic" "trip_characteristic",
	"rated_current_milli" integer,
	"rcd_type" "rcd_type",
	"rated_residual_current_milli" integer,
	"cable_type" text,
	"cable_cores" integer,
	"cable_cross_section_milli" integer,
	"cable_length_milli" integer,
	"cable_installation_method" "cable_installation_method",
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"asset_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "circuits_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "circuits_of_their_asset" UNIQUE("tenant_id","id","asset_id"),
	CONSTRAINT "circuits_rated_current" CHECK ("circuits"."rated_current_milli" is null or "circuits"."rated_current_milli" between 1 and 6300000),
	CONSTRAINT "circuits_rated_residual_current" CHECK ("circuits"."rated_residual_current_milli" is null or "circuits"."rated_residual_current_milli" between 1 and 30000),
	CONSTRAINT "circuits_cable_cores" CHECK ("circuits"."cable_cores" is null or "circuits"."cable_cores" between 1 and 100),
	CONSTRAINT "circuits_cable_cross_section" CHECK ("circuits"."cable_cross_section_milli" is null or "circuits"."cable_cross_section_milli" between 1 and 1000000),
	CONSTRAINT "circuits_cable_length" CHECK ("circuits"."cable_length_milli" is null or "circuits"."cable_length_milli" between 1 and 100000000)
);
--> statement-breakpoint
ALTER TABLE "circuits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "distribution_boards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "distribution_board_kind" NOT NULL,
	"designation" text NOT NULL,
	"location" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"asset_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "distribution_boards_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "distribution_boards_of_their_asset" UNIQUE("tenant_id","id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "distribution_boards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"circuit_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"kind" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"asset_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_board_in_tenant" FOREIGN KEY ("tenant_id","distribution_board_id") REFERENCES "public"."distribution_boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "board_sections" ADD CONSTRAINT "board_sections_on_a_board_of_their_asset" FOREIGN KEY ("tenant_id","distribution_board_id","asset_id") REFERENCES "public"."distribution_boards"("tenant_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_board_in_tenant" FOREIGN KEY ("tenant_id","distribution_board_id") REFERENCES "public"."distribution_boards"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_section_belongs_to_board" FOREIGN KEY ("board_section_id","distribution_board_id") REFERENCES "public"."board_sections"("id","distribution_board_id") ON DELETE SET NULL ("board_section_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_on_a_board_of_their_asset" FOREIGN KEY ("tenant_id","distribution_board_id","asset_id") REFERENCES "public"."distribution_boards"("tenant_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_circuit_in_tenant" FOREIGN KEY ("tenant_id","circuit_id") REFERENCES "public"."circuits"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_on_a_circuit_of_their_asset" FOREIGN KEY ("tenant_id","circuit_id","asset_id") REFERENCES "public"."circuits"("tenant_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_sections_board_idx" ON "board_sections" USING btree ("distribution_board_id");--> statement-breakpoint
CREATE INDEX "board_sections_asset_idx" ON "board_sections" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "circuits_board_idx" ON "circuits" USING btree ("distribution_board_id");--> statement-breakpoint
CREATE INDEX "circuits_asset_idx" ON "circuits" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "distribution_boards_asset_idx" ON "distribution_boards" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "equipment_circuit_idx" ON "equipment" USING btree ("circuit_id");--> statement-breakpoint
CREATE INDEX "equipment_asset_idx" ON "equipment" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "board_sections" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("board_sections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("board_sections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "board_sections" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "board_sections" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "board_sections"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("board_sections"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "board_sections"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "board_sections"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("board_sections"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "board_sections"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "circuits" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("circuits"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("circuits"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "circuits" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "circuits" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "circuits"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("circuits"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "circuits"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "circuits"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("circuits"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "circuits"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "distribution_boards" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("distribution_boards"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("distribution_boards"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "distribution_boards" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "distribution_boards" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "distribution_boards"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("distribution_boards"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "distribution_boards"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "distribution_boards"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("distribution_boards"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "distribution_boards"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("equipment"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("equipment"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "equipment" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "equipment" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "equipment"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("equipment"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "equipment"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "equipment"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("equipment"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "equipment"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
ALTER TABLE "distribution_boards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "board_sections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "circuits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "distribution_boards" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "board_sections" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "circuits" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "equipment" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "distribution_boards"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "board_sections"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "circuits"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "equipment"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "distribution_boards"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "board_sections"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "circuits"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "equipment"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- What hangs below a marked part is marked with it, at the same moment, one
-- level per branch: the marked board marks its sections and circuits in turn,
-- by the same trigger, and so on down. One function for the five levels,
-- asked which table it fires on, as in the trades application: five functions
-- would be five places to forget the next level in. Only the step from live
-- to deleted: nothing here brings a row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: every part has
-- the area of its asset, so whoever may mark the asset or the part sees all
-- that hangs below it. Every statement names the tenant.
CREATE FUNCTION "mark_structure_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'assets' THEN
		UPDATE public.distribution_boards SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'distribution_boards' THEN
		UPDATE public.board_sections SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND distribution_board_id = new.id AND deleted_at IS NULL;
		UPDATE public.circuits SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND distribution_board_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'board_sections' THEN
		UPDATE public.circuits SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND board_section_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'circuits' THEN
		UPDATE public.equipment SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND circuit_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_below"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "distribution_boards"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_below"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "board_sections"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_below"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "circuits"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_below"();--> statement-breakpoint

-- A board hangs on a low-voltage installation and nothing else (decision 31
-- of phase 2), and such an installation with boards that are not marked keeps
-- its kind: no key can say either. Asked on the board when it is made or put
-- on another asset, and on the asset when its kind changes. An asset the
-- person does not see is not found here; the key onto it refuses that one,
-- and the policy `within_areas` the board in an area the person has not.
CREATE FUNCTION "boards_on_a_low_voltage_installation"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_table_name = 'distribution_boards' THEN
		IF EXISTS (SELECT 1 FROM public.assets
		            WHERE tenant_id = new.tenant_id AND id = new.asset_id
		              AND kind <> 'elektro.low_voltage_installation') THEN
			RAISE EXCEPTION 'Ein Verteiler hängt nur unter einer Niederspannungsanlage.'
				USING ERRCODE = 'HT014';
		END IF;
	ELSIF new.kind <> 'elektro.low_voltage_installation'
	  AND EXISTS (SELECT 1 FROM public.distribution_boards
	               WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL) THEN
		RAISE EXCEPTION 'Eine Niederspannungsanlage mit Verteilern bleibt eine Niederspannungsanlage.'
			USING ERRCODE = 'HT014';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "on_a_low_voltage_installation" BEFORE INSERT OR UPDATE OF "asset_id" ON "distribution_boards"
	FOR EACH ROW EXECUTE FUNCTION "boards_on_a_low_voltage_installation"();--> statement-breakpoint
CREATE TRIGGER "boards_keep_their_installation" BEFORE UPDATE OF "kind" ON "assets"
	FOR EACH ROW WHEN (new.kind IS DISTINCT FROM old.kind)
	EXECUTE FUNCTION "boards_on_a_low_voltage_installation"();
