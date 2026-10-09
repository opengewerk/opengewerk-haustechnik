-- The plans of the rounds (#113, section 4.5 of the concept): which template
-- is walked where, in which rhythm and by whom, with the lead of a round on
-- site. Every pass that falls due is a round of its own, made once by the
-- deadline engine (section 2.4) from the source `round_plan`.
--
-- A plan lies at a property or at a building there, in the area of the
-- property: the key over (tenant_id, building_id, property_id) holds that the
-- building stands on the property, and the key over (tenant_id, property_id,
-- area_id) with ON UPDATE CASCADE and the restrictive policy `within_areas`
-- keep the area (ADR 0003). The rows travel to a device, to read. No plan is
-- deleted, so the application role has no DELETE: one ends on a day or rests,
-- and the rounds it made stay. A building or a property that is marked marks
-- its plans, at the same moment.
--
-- A round names the plan that made it (`activities.round_plan_id`), and the
-- unique index `activities_once_per_pass` holds one live round for each day
-- of a plan: two runs of the engine, or the engine and a route at the same
-- moment, make it once. A deadline follows a duty, a defect or a plan.
--
-- Everything from the table down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks the plans, every
-- activity and every deadline it reads has no plan, and the check over the
-- source of a deadline holds for every row it wrote.
CREATE TYPE "public"."round_plan_rhythm" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TABLE "round_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"building_id" uuid,
	"area_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"rhythm" "round_plan_rhythm" NOT NULL,
	"weekdays" smallint[],
	"day_of_month" smallint,
	"month" smallint,
	"lead_days" smallint DEFAULT 0 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"resting" boolean DEFAULT false NOT NULL,
	"performer_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "round_plans_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "round_plans_days_of_their_rhythm" CHECK (coalesce(case "round_plans"."rhythm"
        when 'daily' then cardinality("round_plans"."weekdays") between 1 and 7 and "round_plans"."day_of_month" is null and "round_plans"."month" is null
        when 'weekly' then cardinality("round_plans"."weekdays") = 1 and "round_plans"."day_of_month" is null and "round_plans"."month" is null
        when 'monthly' then "round_plans"."weekdays" is null and "round_plans"."day_of_month" between 1 and 31 and "round_plans"."month" is null
        else "round_plans"."weekdays" is null and "round_plans"."month" between 1 and 12 and "round_plans"."day_of_month" between 1 and (case when "round_plans"."month" = 2 then 29 when "round_plans"."month" in (4, 6, 9, 11) then 30 else 31 end)
      end, false)),
	CONSTRAINT "round_plans_weekdays_shaped" CHECK ("round_plans"."weekdays" is null or ("round_plans"."weekdays" <@ '{1,2,3,4,5,6,7}'::smallint[] and array_position("round_plans"."weekdays", null) is null)),
	CONSTRAINT "round_plans_lead" CHECK ("round_plans"."lead_days" between 0 and 14),
	CONSTRAINT "round_plans_in_order" CHECK ("round_plans"."ends_on" is null or "round_plans"."starts_on" <= "round_plans"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "round_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "round_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "round_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_of_a_template" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."round_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_performer_works_here" FOREIGN KEY ("tenant_id","performer_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "round_plans_property_idx" ON "round_plans" USING btree ("tenant_id","property_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_of_a_plan_of_their_property" FOREIGN KEY ("tenant_id","round_plan_id","property_id") REFERENCES "public"."round_plans"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_plan_of_their_property" FOREIGN KEY ("tenant_id","round_plan_id","property_id") REFERENCES "public"."round_plans"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_once_per_pass" ON "activities" USING btree ("tenant_id","round_plan_id","due_on") WHERE "activities"."round_plan_id" is not null and "activities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "deadlines_round_plan_idx" ON "deadlines" USING btree ("tenant_id","round_plan_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_plan_makes_rounds" CHECK ("activities"."round_plan_id" is null or ("activities"."kind" = 'round' and "activities"."due_on" is not null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "round_plans" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("round_plans"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("round_plans"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "round_plans" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "round_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "round_plans" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "round_plans"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "round_plans"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The plans of a marked building or property are marked with it, at the same
-- moment: no round is made for a place that is gone, and a device that holds
-- a plan hears that it may let it go. A property that is marked marks its
-- buildings (`mark_places_below`), and the plans of the property itself are
-- marked here. Only the step from live to deleted: nothing here brings a row
-- back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: a plan has the
-- area of its property, so whoever may mark the place sees its plans. The
-- statement names the tenant.
CREATE FUNCTION "mark_plans_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF TG_TABLE_NAME = 'buildings' THEN
		UPDATE public.round_plans SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSE
		UPDATE public.round_plans SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "plans_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_plans_below"();--> statement-breakpoint
CREATE TRIGGER "plans_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_plans_below"();
