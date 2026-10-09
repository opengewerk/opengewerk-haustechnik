-- The work orders in the office (#117, #73, section 4.8 of the concept).
--
-- `work_orders` says how urgent an order is, normal, urgent or at once, every
-- order there is normal; and which defect it came of. The defect names the
-- order that sets it right now (`remedy_work_order_id`), which a new order
-- replaces when a check finds the defect not set right; the order keeps the
-- defect it came of. No route set that reference before, so no order names a
-- defect yet.
--
-- `work_order_participants` holds the further people of an order, beside the
-- person who answers for it: one row per person, once per order among the
-- rows that are not marked, on the activity of the order with its kind in the
-- key, as `work_orders` has it. A person taken off an order is marked; the
-- application may read, add and change a row, and not delete one.
CREATE TYPE "public"."work_order_urgency" AS ENUM('normal', 'urgent', 'immediate');--> statement-breakpoint
CREATE TABLE "work_order_participants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"activity_kind" "activity_kind" DEFAULT 'work_order' NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_order_participants_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_order_participants_of_a_work_order" CHECK ("work_order_participants"."activity_kind" = 'work_order')
);
--> statement-breakpoint
ALTER TABLE "work_order_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "urgency" "work_order_urgency" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "origin_defect_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_participants" ADD CONSTRAINT "work_order_participants_work_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_participants_activity_idx" ON "work_order_participants" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "work_order_participants_user_idx" ON "work_order_participants" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_participants_once" ON "work_order_participants" USING btree ("tenant_id","activity_id","user_id") WHERE "work_order_participants"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_from_a_defect_of_their_property" FOREIGN KEY ("tenant_id","origin_defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_orders_origin_defect_idx" ON "work_orders" USING btree ("tenant_id","origin_defect_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_order_participants" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_order_participants"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_order_participants"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "work_order_participants" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "work_order_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "work_order_participants" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_participants"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_order_participants"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();
