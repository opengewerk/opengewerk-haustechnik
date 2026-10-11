-- The tasks of an operator (#124, section 3 of the concept): something one
-- person has to do by a day, at a property and on request at one building,
-- room, asset or activity there, with the columns of the task of the
-- foundation (`TaskBase`) under their names.
--
-- A task carries the property and the area of its place, kept by the key over
-- (tenant_id, property_id, area_id) with ON UPDATE CASCADE and the restrictive
-- policy `within_areas` (ADR 0003): it is seen by whoever sees its place. The
-- person it is for is held to the operator by the key over the membership.
-- Who wrote it is written by a trigger from the person of the transaction,
-- and stays empty for a task no person wrote, which is how the deadline engine
-- will write one. A task is marked and never deleted: the application may
-- read, add and change a row, and a marked record takes its tasks along, as
-- it takes its documents (0019).
--
-- Everything from the type down to the policies is what drizzle-kit generated
-- from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks this table, and
-- nothing it writes is changed: the triggers on the places only mark tasks.
CREATE TYPE "public"."task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_on" date NOT NULL,
	"assignee_user_id" text NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"asset_id" uuid,
	"activity_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "tasks_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_hang_on_one_record" CHECK (num_nonnulls("tasks"."building_id", "tasks"."room_id", "tasks"."asset_id", "tasks"."activity_id") <= 1),
	CONSTRAINT "tasks_title_shaped" CHECK ("tasks"."title" = btrim("tasks"."title") and char_length("tasks"."title") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_at_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_works_here" FOREIGN KEY ("tenant_id","assignee_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("tenant_id","assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_property_idx" ON "tasks" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "tasks_asset_idx" ON "tasks" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "tasks_activity_idx" ON "tasks" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tasks"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tasks"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "tasks" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tasks" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- Who wrote a task, from the request and from nothing else: a device that
-- named somebody could put its task under another's name. Empty for a task no
-- person wrote.
CREATE FUNCTION "record_task_author"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.created_by := nullif(current_setting('app.user_id', true), '');

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "record_task_author" BEFORE INSERT ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "record_task_author"();--> statement-breakpoint

-- The tasks of a marked record are marked with it, at the same moment: a task
-- at an asset that is gone is nobody's to do any more, and a device that
-- holds it hears that it may let it go. A property takes every task on it
-- along, whatever that hangs on; a building, a room, an asset and an activity
-- take their own. Only the step from live to deleted: nothing here brings a
-- row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: a task has the
-- area of its property, so whoever may mark the record sees its tasks. The
-- statement names the tenant.
CREATE FUNCTION "mark_tasks_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.tasks SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'buildings' THEN
		UPDATE public.tasks SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.tasks SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.tasks SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'activities' THEN
		UPDATE public.tasks SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND activity_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tasks_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_tasks_below"();--> statement-breakpoint
CREATE TRIGGER "tasks_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_tasks_below"();--> statement-breakpoint
CREATE TRIGGER "tasks_follow_deletion" AFTER UPDATE OF "deleted_at" ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "mark_tasks_below"();--> statement-breakpoint
CREATE TRIGGER "tasks_follow_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_tasks_below"();--> statement-breakpoint
CREATE TRIGGER "tasks_follow_deletion" AFTER UPDATE OF "deleted_at" ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "mark_tasks_below"();
