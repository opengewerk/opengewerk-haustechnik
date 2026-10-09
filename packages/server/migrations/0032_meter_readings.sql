-- The readings of a measuring point and what it holds beside its asset (#119,
-- section 4.9 of the concept).
--
-- `meter_points` holds what only a measuring point carries, one row per
-- asset: the conversion factor, the main meter on the same property, the id in
-- the building management system, a note with who wrote it and since when, and
-- a lock with its reason and since when. `meter_readings` holds the readings,
-- in thousandths of the unit of the meter: for a key date, the first of a
-- month, read on a day, with how it came and who entered it. A reading is
-- written once: a correction is a reading of its own for the same key date
-- that names the one it corrects and the reason, and a reading is corrected
-- once. `meter_exchanges` holds the replacements of a meter, written once, one
-- a day; `meter_pauses` the periods a measuring point rests, with the reason.
--
-- Every row hangs on its asset, on its property, and carries the property and
-- the area of its place, kept by the key over (tenant_id, property_id,
-- area_id) with ON UPDATE CASCADE and the restrictive policy `within_areas`
-- (ADR 0003). The application may read and add a reading and a replacement and
-- nothing else, and a trigger refuses a change, a removal and a TRUNCATE of a
-- reading to every role, with the one exception of the area that follows its
-- property by the key; it may change a measuring point and a pause, and
-- delete neither.
--
-- Everything from the type down to the policies is what drizzle-kit generated
-- from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks these tables.
CREATE TYPE "public"."meter_reading_source" AS ENUM('by_hand', 'reading_round', 'round', 'protocol');--> statement-breakpoint
CREATE TABLE "meter_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"exchanged_on" date NOT NULL,
	"old_number" text NOT NULL,
	"old_end_milli" bigint NOT NULL,
	"new_number" text NOT NULL,
	"new_start_milli" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "meter_exchanges_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_exchanges_old_number_shaped" CHECK ("meter_exchanges"."old_number" = btrim("meter_exchanges"."old_number") and char_length("meter_exchanges"."old_number") between 1 and 60),
	CONSTRAINT "meter_exchanges_new_number_shaped" CHECK ("meter_exchanges"."new_number" = btrim("meter_exchanges"."new_number") and char_length("meter_exchanges"."new_number") between 1 and 60),
	CONSTRAINT "meter_exchanges_old_end_shaped" CHECK ("meter_exchanges"."old_end_milli" between 0 and 999999999999999),
	CONSTRAINT "meter_exchanges_new_start_shaped" CHECK ("meter_exchanges"."new_start_milli" between 0 and 999999999999999)
);
--> statement-breakpoint
ALTER TABLE "meter_exchanges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meter_pauses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "meter_pauses_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_pauses_reason_shaped" CHECK ("meter_pauses"."reason" = btrim("meter_pauses"."reason") and char_length("meter_pauses"."reason") between 1 and 500),
	CONSTRAINT "meter_pauses_end_after_start" CHECK ("meter_pauses"."ends_on" is null or "meter_pauses"."ends_on" >= "meter_pauses"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "meter_pauses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meter_points" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"conversion_factor" integer,
	"main_meter_id" uuid,
	"control_id" text,
	"note" text,
	"note_by" text,
	"noted_on" date,
	"lock_reason" text,
	"locked_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "meter_points_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_points_one_per_asset" UNIQUE("tenant_id","asset_id"),
	CONSTRAINT "meter_points_factor_shaped" CHECK ("meter_points"."conversion_factor" is null or "meter_points"."conversion_factor" between 1 and 100000),
	CONSTRAINT "meter_points_control_id_shaped" CHECK ("meter_points"."control_id" is null or ("meter_points"."control_id" = btrim("meter_points"."control_id") and char_length("meter_points"."control_id") between 1 and 100)),
	CONSTRAINT "meter_points_note_shaped" CHECK ("meter_points"."note" is null or ("meter_points"."note" = btrim("meter_points"."note") and char_length("meter_points"."note") between 1 and 1000)),
	CONSTRAINT "meter_points_lock_reason_shaped" CHECK ("meter_points"."lock_reason" is null or ("meter_points"."lock_reason" = btrim("meter_points"."lock_reason") and char_length("meter_points"."lock_reason") between 1 and 500)),
	CONSTRAINT "meter_points_note_whole" CHECK (("meter_points"."note" is null) = ("meter_points"."note_by" is null) and ("meter_points"."note" is null) = ("meter_points"."noted_on" is null)),
	CONSTRAINT "meter_points_lock_whole" CHECK (("meter_points"."lock_reason" is null) = ("meter_points"."locked_on" is null)),
	CONSTRAINT "meter_points_not_their_own_main_meter" CHECK ("meter_points"."main_meter_id" is distinct from "meter_points"."asset_id")
);
--> statement-breakpoint
ALTER TABLE "meter_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"key_date" date NOT NULL,
	"read_on" date NOT NULL,
	"value_milli" bigint NOT NULL,
	"source" "meter_reading_source" NOT NULL,
	"activity_id" uuid,
	"corrects_id" uuid,
	"correction_reason" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "meter_readings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_readings_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "meter_readings_on_a_key_date" CHECK (extract(day from "meter_readings"."key_date") = 1),
	CONSTRAINT "meter_readings_value_shaped" CHECK ("meter_readings"."value_milli" between 0 and 999999999999999),
	CONSTRAINT "meter_readings_correction_reason_shaped" CHECK ("meter_readings"."correction_reason" is null or ("meter_readings"."correction_reason" = btrim("meter_readings"."correction_reason") and char_length("meter_readings"."correction_reason") between 1 and 500)),
	CONSTRAINT "meter_readings_corrected_with_a_reason" CHECK (("meter_readings"."corrects_id" is null) = ("meter_readings"."correction_reason" is null)),
	CONSTRAINT "meter_readings_not_their_own_correction" CHECK ("meter_readings"."corrects_id" is distinct from "meter_readings"."id")
);
--> statement-breakpoint
ALTER TABLE "meter_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meter_exchanges" ADD CONSTRAINT "meter_exchanges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_exchanges" ADD CONSTRAINT "meter_exchanges_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_exchanges" ADD CONSTRAINT "meter_exchanges_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_pauses" ADD CONSTRAINT "meter_pauses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_pauses" ADD CONSTRAINT "meter_pauses_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_pauses" ADD CONSTRAINT "meter_pauses_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_under_a_meter_of_their_property" FOREIGN KEY ("tenant_id","main_meter_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_noted_by_somebody_here" FOREIGN KEY ("tenant_id","note_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_correct_a_reading_here" FOREIGN KEY ("tenant_id","corrects_id","property_id") REFERENCES "public"."meter_readings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_recorded_by_somebody_here" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meter_exchanges_once_a_day" ON "meter_exchanges" USING btree ("tenant_id","asset_id","exchanged_on");--> statement-breakpoint
CREATE INDEX "meter_pauses_asset_idx" ON "meter_pauses" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "meter_points_main_meter_idx" ON "meter_points" USING btree ("tenant_id","main_meter_id");--> statement-breakpoint
CREATE INDEX "meter_readings_asset_idx" ON "meter_readings" USING btree ("tenant_id","asset_id","key_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meter_readings_one_per_key_date" ON "meter_readings" USING btree ("tenant_id","asset_id","key_date") WHERE "meter_readings"."corrects_id" is null and "meter_readings"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "meter_readings_corrected_once" ON "meter_readings" USING btree ("tenant_id","corrects_id") WHERE "meter_readings"."corrects_id" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meter_exchanges" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("meter_exchanges"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("meter_exchanges"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "meter_exchanges" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meter_pauses" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("meter_pauses"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("meter_pauses"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "meter_pauses" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meter_points" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("meter_points"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("meter_points"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "meter_points" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meter_readings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("meter_readings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("meter_readings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "meter_readings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "meter_points" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meter_readings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meter_exchanges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meter_pauses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "meter_points" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "meter_readings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "meter_exchanges" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "meter_pauses" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "meter_points"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "meter_readings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "meter_exchanges"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "meter_pauses"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "meter_points"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "meter_readings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "meter_exchanges"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "meter_pauses"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal of a reading, for any role. The area alone may
-- follow the property, and only from the key: then the trigger runs one level
-- deeper than the statement, and every other column is what it was. It runs
-- before `stamp_sync_columns`, triggers of one kind running in the order of
-- their names, so that the columns of the sync are still the old ones here.
CREATE FUNCTION "reading_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'UPDATE' THEN
		IF pg_trigger_depth() > 1
		   AND old.area_id IS DISTINCT FROM new.area_id
		   AND (to_jsonb(new) - 'area_id') = (to_jsonb(old) - 'area_id') THEN
			RETURN new;
		END IF;
	END IF;

	RAISE EXCEPTION 'Ein Zählerstand wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Stand, der ihn nennt.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "meter_readings"
	FOR EACH ROW EXECUTE FUNCTION "reading_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "meter_readings"
	FOR EACH STATEMENT EXECUTE FUNCTION "reading_kept_as_written"();
