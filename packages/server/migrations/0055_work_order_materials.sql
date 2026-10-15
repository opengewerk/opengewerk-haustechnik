-- Material at a work order (#326, sections 4.8 and 4.12 of the concept).
--
-- `work_order_materials`: what was taken from which store for a work order,
-- on site and also without a connection. It hangs on its work order and lies
-- in its area, as a note does (0031), and is never changed or removed: the
-- application may read and add one, and a trigger refuses a change and a
-- removal to every role but the area and the property following the order
-- from their keys. The server books every withdrawal once in its store:
-- `stock_movements` gets `material_id`, unique where it is set, and a booking
-- of the kind "withdrawal" is one of a withdrawal and nothing else.
--
-- `store_labels`: the label on the shelf of an article in a store, printed
-- like the labels of assets and rooms (0020). Tenant-wide like the stores;
-- made and blocked in the office, never removed.

CREATE TABLE "store_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_article_id" uuid NOT NULL,
	"code" text NOT NULL,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "store_labels_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "store_labels_code_shaped" CHECK ("store_labels"."code" ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$')
);
--> statement-breakpoint
ALTER TABLE "store_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_order_materials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"activity_kind" "activity_kind" DEFAULT 'work_order' NOT NULL,
	"store_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"quantity_milli" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"taken_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_order_materials_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_order_materials_of_a_work_order" CHECK ("work_order_materials"."activity_kind" = 'work_order'),
	CONSTRAINT "work_order_materials_quantity_above_zero" CHECK ("work_order_materials"."quantity_milli" between 1 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "work_order_materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "store_labels" ADD CONSTRAINT "store_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_labels" ADD CONSTRAINT "store_labels_on_a_shelf_here" FOREIGN KEY ("tenant_id","store_article_id") REFERENCES "public"."store_articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id","activity_kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_from_a_store_here" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_of_an_article_here" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_taken_by_somebody_here" FOREIGN KEY ("tenant_id","taken_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_labels_code_once" ON "store_labels" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "store_labels_one_valid_per_shelf" ON "store_labels" USING btree ("tenant_id","store_article_id") WHERE "store_labels"."blocked_at" is null and "store_labels"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_order_materials_activity_idx" ON "work_order_materials" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_book_a_material_once" ON "stock_movements" USING btree ("tenant_id","material_id") WHERE "stock_movements"."material_id" is not null;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_a_withdrawal_books_a_material" CHECK (("stock_movements"."kind" = 'withdrawal') = ("stock_movements"."material_id" is not null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_labels" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("store_labels"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("store_labels"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_order_materials" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_order_materials"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_order_materials"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "work_order_materials" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "work_order_materials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "work_order_materials" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "store_labels" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("blocked_at", "deleted_at") ON "store_labels" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_materials"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_order_materials"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "store_labels"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "store_labels"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal of a withdrawal, for any role. The area and the
-- property alone may follow the work order, and only from the keys: then the
-- trigger runs one level deeper than the statement, and every other column is
-- what it was. It runs before `stamp_sync_columns`, triggers of one kind
-- running in the order of their names.
CREATE FUNCTION "material_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'UPDATE' THEN
		IF pg_trigger_depth() > 1
		   AND (old.area_id IS DISTINCT FROM new.area_id OR old.property_id IS DISTINCT FROM new.property_id)
		   AND (to_jsonb(new) - 'area_id' - 'property_id') = (to_jsonb(old) - 'area_id' - 'property_id') THEN
			RETURN new;
		END IF;
	END IF;

	RAISE EXCEPTION 'Eine Entnahme am Auftrag wird nicht geändert und nicht gelöscht. Was nicht stimmt, berichtigt eine Zählung im Lager.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "work_order_materials"
	FOR EACH ROW EXECUTE FUNCTION "material_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "work_order_materials"
	FOR EACH STATEMENT EXECUTE FUNCTION "material_kept_as_written"();
