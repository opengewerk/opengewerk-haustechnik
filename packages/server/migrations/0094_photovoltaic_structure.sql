-- The PV structure below a PV installation (#461, section 4.2 of the
-- concept): the inverters of the installation, the strings on each and the
-- modules of a string. The tables are the foundation's (`photovoltaicSchema`,
-- ADR 0014 in the repository opengewerk), under the names the trades
-- application gives them, made the way 0092 makes the electrical structure:
-- every part carries the asset, its property and its area, kept by the keys
-- onto the asset with ON UPDATE CASCADE, and the restrictive policies
-- `within_areas` and `within_limits` (ADR 0003, #339). An inverter hangs on
-- its asset; a string and a module carry the same asset, which the keys over
-- tenant, parent and asset hold. An inverter says where it hangs as well, in
-- the column `location` of this application's own.
--
-- Everything from the tables down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand:
--
-- **Rights.** The application reads, adds and changes the rows and deletes
-- none: a part is marked, like every record that travels.
--
-- **Marked as deleted, all the way down.** An asset that is marked takes its
-- inverters along, an inverter its strings and a string its modules, in the
-- same statement and with the same moment, by the one function of 0092 that
-- marks the electrical structure, which gets the levels of this one.
--
-- **Only under a PV installation.** An inverter hangs on an asset of the kind
-- `elektro.photovoltaic_installation` (package Elektro 1.4.0), and such an
-- asset with inverters keeps its kind; a trigger refuses anything else with
-- the error class HT015. The sync asks the same before, as a conflict about
-- the one inverter.
--
-- No right is new: the structure is read, taken stock of and kept with the
-- rights of the assets.
--
-- **Fits the version before it.** That version knows none of the tables, and
-- the function that marks the structure does for the electrical one what it
-- did before.
CREATE TABLE "inverters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"rated_power_w" integer,
	"mpp_inputs" integer,
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
	"location" text,
	CONSTRAINT "inverters_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "inverters_of_their_asset" UNIQUE("tenant_id","id","asset_id"),
	CONSTRAINT "inverters_rated_power" CHECK ("inverters"."rated_power_w" is null or "inverters"."rated_power_w" between 1 and 10000000),
	CONSTRAINT "inverters_mpp_inputs" CHECK ("inverters"."mpp_inputs" is null or "inverters"."mpp_inputs" between 1 and 24)
);
--> statement-breakpoint
ALTER TABLE "inverters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pv_modules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pv_string_id" uuid NOT NULL,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"rated_power_w" integer,
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
	CONSTRAINT "pv_modules_rated_power" CHECK ("pv_modules"."rated_power_w" is null or "pv_modules"."rated_power_w" between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "pv_modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pv_strings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inverter_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"mpp_input" integer,
	"azimuth_deg" integer,
	"tilt_deg" integer,
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
	CONSTRAINT "pv_strings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "pv_strings_of_their_asset" UNIQUE("tenant_id","id","asset_id"),
	CONSTRAINT "pv_strings_mpp_input" CHECK ("pv_strings"."mpp_input" is null or "pv_strings"."mpp_input" between 1 and 24),
	CONSTRAINT "pv_strings_azimuth" CHECK ("pv_strings"."azimuth_deg" is null or "pv_strings"."azimuth_deg" between 0 and 359),
	CONSTRAINT "pv_strings_tilt" CHECK ("pv_strings"."tilt_deg" is null or "pv_strings"."tilt_deg" between 0 and 90)
);
--> statement-breakpoint
ALTER TABLE "pv_strings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inverters" ADD CONSTRAINT "inverters_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_string_in_tenant" FOREIGN KEY ("tenant_id","pv_string_id") REFERENCES "public"."pv_strings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pv_modules" ADD CONSTRAINT "pv_modules_on_a_string_of_their_asset" FOREIGN KEY ("tenant_id","pv_string_id","asset_id") REFERENCES "public"."pv_strings"("tenant_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_inverter_in_tenant" FOREIGN KEY ("tenant_id","inverter_id") REFERENCES "public"."inverters"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pv_strings" ADD CONSTRAINT "pv_strings_on_an_inverter_of_their_asset" FOREIGN KEY ("tenant_id","inverter_id","asset_id") REFERENCES "public"."inverters"("tenant_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inverters_asset_idx" ON "inverters" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "pv_modules_string_idx" ON "pv_modules" USING btree ("pv_string_id");--> statement-breakpoint
CREATE INDEX "pv_modules_asset_idx" ON "pv_modules" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "pv_strings_inverter_idx" ON "pv_strings" USING btree ("inverter_id");--> statement-breakpoint
CREATE INDEX "pv_strings_asset_idx" ON "pv_strings" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inverters" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("inverters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("inverters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "inverters" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "inverters" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "inverters"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("inverters"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "inverters"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "inverters"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("inverters"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "inverters"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pv_modules" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("pv_modules"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("pv_modules"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "pv_modules" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "pv_modules" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "pv_modules"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("pv_modules"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "pv_modules"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "pv_modules"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("pv_modules"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "pv_modules"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pv_strings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("pv_strings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("pv_strings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "pv_strings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "pv_strings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "pv_strings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("pv_strings"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "pv_strings"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "pv_strings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR ("pv_strings"."asset_id" IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = "pv_strings"."asset_id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))));--> statement-breakpoint
ALTER TABLE "inverters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_strings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pv_modules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inverters" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pv_strings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pv_modules" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "inverters"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "pv_strings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "pv_modules"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "inverters"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "pv_strings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "pv_modules"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The one function of 0092 that marks what hangs below a marked part, with
-- the levels of the PV structure: a marked asset marks its inverters beside
-- its boards, an inverter its strings and a string its modules, by the same
-- trigger level by level. One function for both structures, for the reason
-- 0092 gives: one place to forget the next level in rather than several.
-- Only the step from live to deleted, and not SECURITY DEFINER, as there:
-- every part has the area of its asset.
CREATE OR REPLACE FUNCTION "mark_structure_below"() RETURNS trigger
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
		UPDATE public.inverters SET deleted_at = new.deleted_at
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
	ELSIF tg_table_name = 'inverters' THEN
		UPDATE public.pv_strings SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND inverter_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'pv_strings' THEN
		UPDATE public.pv_modules SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND pv_string_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "inverters"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_below"();--> statement-breakpoint
CREATE TRIGGER "structure_follows_deletion" AFTER UPDATE OF "deleted_at" ON "pv_strings"
	FOR EACH ROW EXECUTE FUNCTION "mark_structure_below"();--> statement-breakpoint

-- An inverter hangs on a PV installation and nothing else, and such an
-- installation with inverters that are not marked keeps its kind: no key can
-- say either. Asked on the inverter when it is made or put on another asset,
-- and on the asset when its kind changes, as 0092 asks it of a board. An
-- asset the person does not see is not found here; the key onto it refuses
-- that one, and the policy `within_areas` the inverter in an area the person
-- has not.
CREATE FUNCTION "inverters_on_a_photovoltaic_installation"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_table_name = 'inverters' THEN
		IF EXISTS (SELECT 1 FROM public.assets
		            WHERE tenant_id = new.tenant_id AND id = new.asset_id
		              AND kind <> 'elektro.photovoltaic_installation') THEN
			RAISE EXCEPTION 'Ein Wechselrichter hängt nur unter einer PV-Anlage.'
				USING ERRCODE = 'HT015';
		END IF;
	ELSIF new.kind <> 'elektro.photovoltaic_installation'
	  AND EXISTS (SELECT 1 FROM public.inverters
	               WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL) THEN
		RAISE EXCEPTION 'Eine PV-Anlage mit Wechselrichtern bleibt eine PV-Anlage.'
			USING ERRCODE = 'HT015';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "on_a_photovoltaic_installation" BEFORE INSERT OR UPDATE OF "asset_id" ON "inverters"
	FOR EACH ROW EXECUTE FUNCTION "inverters_on_a_photovoltaic_installation"();--> statement-breakpoint
CREATE TRIGGER "inverters_keep_their_installation" BEFORE UPDATE OF "kind" ON "assets"
	FOR EACH ROW WHEN (new.kind IS DISTINCT FROM old.kind)
	EXECUTE FUNCTION "inverters_on_a_photovoltaic_installation"();
