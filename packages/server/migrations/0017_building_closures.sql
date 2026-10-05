-- The times a building is closed (section 4.1 of the concept,
-- opengewerk-haustechnik#86): the holidays of a school, the days between the
-- years, a refurbishment. While a building is closed no round is made for it
-- (section 4.5), which the plan of a round asks when it makes one.
--
-- A closure runs from a day to a day, both of them closed, and says on request
-- what it is for. It hangs on its building: the key over (tenant_id,
-- building_id, property_id) holds that the building stands on the property the
-- row names. Like every row with a place it carries the area of its property,
-- kept by the key over (tenant_id, property_id, area_id) with ON UPDATE
-- CASCADE, and the restrictive policy `within_areas` (ADR 0003).
--
-- The rows travel to a device, to read. Deleting marks a row: the application
-- role has no DELETE, and a trigger marks the closures of a building that is
-- marked, at the same moment. No route changes a closure in place; one that
-- was entered wrongly is removed and entered again.
--
-- Everything from the table down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks this table, and
-- nothing it writes is changed.
CREATE TABLE "building_closures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "building_closures_in_order" CHECK ("building_closures"."starts_on" <= "building_closures"."ends_on"),
	CONSTRAINT "building_closures_reason_shaped" CHECK ("building_closures"."reason" is null or ("building_closures"."reason" = btrim("building_closures"."reason") and char_length("building_closures"."reason") between 1 and 80))
);
--> statement-breakpoint
ALTER TABLE "building_closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "building_closures" ADD CONSTRAINT "building_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_closures" ADD CONSTRAINT "building_closures_of_their_building" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_closures" ADD CONSTRAINT "building_closures_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "building_closures_building_idx" ON "building_closures" USING btree ("tenant_id","building_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "building_closures" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("building_closures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("building_closures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "building_closures" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "building_closures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "building_closures" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "building_closures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "building_closures"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The closures of a marked building are marked with it, at the same moment:
-- a building that is gone is closed on no day, and a device that holds its
-- closures hears that it may let them go. A property that is marked marks its
-- buildings (`mark_places_below`), and each of those fires this. Only the step
-- from live to deleted: nothing here brings a row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: a closure has
-- the area of its building, so whoever may mark the building sees its
-- closures. The statement names the tenant.
CREATE FUNCTION "mark_closures_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	UPDATE public.building_closures SET deleted_at = new.deleted_at
	 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "closures_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_closures_below"();
