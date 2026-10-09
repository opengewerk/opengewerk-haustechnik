-- The notes on a work order and the time spent on it (#118, section 4.8 of
-- the concept).
--
-- `work_order_notes` holds a note per row, written on site by whoever works
-- on the order, with the moment of the device it was written on and the
-- person signed in, which the server writes. It hangs on the activity of the
-- order with its kind in the key, as `work_orders` and
-- `work_order_participants` have it, and carries the property and the area of
-- its place, kept by the key over (tenant_id, property_id, area_id) with ON
-- UPDATE CASCADE and the restrictive policy `within_areas` (ADR 0003). A note
-- is written once: the application may read and add a row and nothing else,
-- and a trigger refuses a change, a removal and a TRUNCATE to every role, with
-- the one exception of the area that follows its property by the key, as for
-- a signature (0011).
--
-- `work_orders.duration_minutes` is the time spent on an order in whole
-- minutes, one figure for the order and no record of anybody's working time;
-- no order has one yet.
--
-- Everything from the table down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks the notes, and a
-- column it does not know leaves every insert and update of a work order as
-- it was.
CREATE TABLE "work_order_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"activity_kind" "activity_kind" DEFAULT 'work_order' NOT NULL,
	"text" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	"written_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_order_notes_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_order_notes_of_a_work_order" CHECK ("work_order_notes"."activity_kind" = 'work_order'),
	CONSTRAINT "work_order_notes_text_shaped" CHECK ("work_order_notes"."text" = btrim("work_order_notes"."text") and char_length("work_order_notes"."text") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "work_order_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_notes" ADD CONSTRAINT "work_order_notes_written_by_somebody_here" FOREIGN KEY ("tenant_id","written_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_notes_activity_idx" ON "work_order_notes" USING btree ("tenant_id","activity_id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_duration_shaped" CHECK ("work_orders"."duration_minutes" is null or "work_orders"."duration_minutes" between 1 and 599999);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_order_notes" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_order_notes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_order_notes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "work_order_notes" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "work_order_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "work_order_notes" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_notes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_order_notes"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal, for any role. The area alone may follow the
-- property, and only from the key: then the trigger runs one level deeper than
-- the statement, and every other column is what it was. It runs before
-- `stamp_sync_columns`, triggers of one kind running in the order of their
-- names, so that the columns of the sync are still the old ones here.
CREATE FUNCTION "note_kept_as_written"() RETURNS trigger
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

	RAISE EXCEPTION 'Eine Notiz wird nicht geändert und nicht gelöscht. Was nicht stimmt, sagt eine weitere Notiz.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "work_order_notes"
	FOR EACH ROW EXECUTE FUNCTION "note_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "work_order_notes"
	FOR EACH STATEMENT EXECUTE FUNCTION "note_kept_as_written"();
