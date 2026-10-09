-- The key day of the meters and the confirmation of a figure that jumps (#120,
-- section 4.9 of the concept).
--
-- The operator sets the day of the month a reading is due on, the 1st unless
-- it says otherwise, in `meter_settings`, one row per operator, which every
-- device holds; a measuring point may set a day of its own in
-- `meter_points.key_day`. Every month has the day: it lies from the 1st to the
-- 28th, so a key date of a reading is no longer the first of a month but a day
-- up to the 28th. `meter_readings.jump_confirmed` keeps that whoever read a
-- figure far above the one before confirmed it; a figure below the one before
-- is still refused, by the route and by the sync. `deadlines.meter_property_id`
-- is the source `meter` of the deadline engine: the property whose meters are
-- to be read for their key date, one deadline per property.

CREATE TABLE "meter_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_day" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "meter_settings_once" UNIQUE("tenant_id"),
	CONSTRAINT "meter_settings_key_day_in_month" CHECK ("meter_settings"."key_day" between 1 and 28)
);
--> statement-breakpoint
ALTER TABLE "meter_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meter_readings" DROP CONSTRAINT "meter_readings_on_a_key_date";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "meter_points" ADD COLUMN "key_day" smallint;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD COLUMN "jump_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "meter_property_id" uuid;--> statement-breakpoint
ALTER TABLE "meter_settings" ADD CONSTRAINT "meter_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_points" ADD CONSTRAINT "meter_points_key_day_in_month" CHECK ("meter_points"."key_day" is null or "meter_points"."key_day" between 1 and 28);--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_key_day_in_month" CHECK (extract(day from "meter_readings"."key_date") <= 28);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_meters_of_their_property" CHECK ("deadlines"."meter_property_id" is null or "deadlines"."meter_property_id" = "deadlines"."property_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "meter_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("meter_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("meter_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "meter_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "meter_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "meter_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "meter_settings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
