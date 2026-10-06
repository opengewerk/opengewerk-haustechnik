-- The labels with a QR code on assets and rooms (section 3 of the concept,
-- opengewerk-haustechnik#98): the label of the foundation (ADR 0010 of the
-- repository opengewerk), with what a label hangs on here.
--
-- What a label is are the two columns of the foundation: its code, random,
-- drawn by the server, and when it was blocked. What it hangs on is this
-- application's: its property always, and on it an asset or a room, each
-- under a key over the tenant and the property, or neither, for a label from
-- a sheet printed for taking stock, which is given to an asset on site
-- (#99). An asset and a room have at most one valid label.
--
-- The code stands once in the whole instance and not once per tenant: the
-- address on a label names no tenant, and the same address opens the report
-- of a fault without an account later on (section 4.7).
--
-- A label carries the area of its property, kept by the key over
-- (tenant_id, property_id, area_id) with ON UPDATE CASCADE, and the
-- restrictive policy `within_areas` (ADR 0003). The rows travel to a device,
-- to be read: a scan opens an asset without a network.
--
-- The application may read and insert labels, block one and mark it deleted.
-- It may not change the code of a label or what it hangs on: a label is
-- printed, and what it says stays. A blocked label stays blocked, and a
-- record that is marked takes its labels along.
--
-- The function at the top is the building block `labels.sql` of the
-- foundation, which comes with the commit of the foundation this migration
-- follows; the comparison with the building blocks reads its definition.
-- Everything from the table down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks this table, and
-- nothing it writes is changed.

-- Keeps a blocked label blocked. A label is blocked because it was lost or
-- stuck on the wrong thing; one that could be opened again would open
-- whatever it was stuck on, for whoever found it.
CREATE FUNCTION "keep_label_blocked"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.blocked_at IS NOT NULL AND new.blocked_at IS DISTINCT FROM old.blocked_at THEN
		RAISE EXCEPTION 'Ein gesperrtes Etikett bleibt gesperrt.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"asset_id" uuid,
	"room_id" uuid,
	"code" text NOT NULL,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "labels_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "labels_hang_on_one_record" CHECK (num_nonnulls("labels"."asset_id", "labels"."room_id") <= 1),
	CONSTRAINT "labels_code_shaped" CHECK ("labels"."code" ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$')
);
--> statement-breakpoint
ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_on_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_on_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_code_once" ON "labels" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_one_valid_per_asset" ON "labels" USING btree ("tenant_id","asset_id") WHERE "labels"."blocked_at" is null and "labels"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_one_valid_per_room" ON "labels" USING btree ("tenant_id","room_id") WHERE "labels"."blocked_at" is null and "labels"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "labels_property_idx" ON "labels" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "labels" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("labels"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("labels"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "labels" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "labels" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "labels" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("blocked_at", "deleted_at") ON "labels" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "labels"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "labels"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "labels_blocked_stays" BEFORE UPDATE OF "blocked_at" ON "labels"
	FOR EACH ROW EXECUTE FUNCTION "keep_label_blocked"();--> statement-breakpoint

-- The labels of a marked record are marked with it, at the same moment: the
-- label of an asset that is gone opens nothing any more, and a device that
-- holds it hears that it may let it go. A property takes every label on it
-- along, whatever that hangs on, the ones of a sheet included; an asset and a
-- room take their own. A building and a floor mark their rooms, and those
-- their labels. Only the step from live to deleted: nothing here brings a
-- row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: a label has
-- the area of its property, so whoever may mark the record sees its labels.
-- The statement names the tenant.
CREATE FUNCTION "mark_labels_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.labels SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.labels SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.labels SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "labels_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_labels_below"();--> statement-breakpoint
CREATE TRIGGER "labels_follow_deletion" AFTER UPDATE OF "deleted_at" ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "mark_labels_below"();--> statement-breakpoint
CREATE TRIGGER "labels_follow_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_labels_below"();--> statement-breakpoint

-- What a code is in the tenant of the transaction, past the areas of whoever
-- asks: `valid` for a label that opens something, `blocked` for one that
-- opens nothing any more, blocked or gone with its record, and no row for a
-- code no label of this tenant carries.
--
-- SECURITY DEFINER, and the only function of this application that is: a
-- person who scans a label of an asset in another area is told that it lies
-- outside their areas, and not that the label belongs to nobody (section 2.8
-- of the concept). The policy `within_areas` hides such a row from them, so
-- the question has to be asked past it. It answers with one word and hands
-- out no asset, no room, no property and no id, and it reads the tenant from
-- the transaction and takes none as an argument: nobody learns anything about
-- a label of another tenant.
CREATE FUNCTION "label_state_in_tenant"("asked" text) RETURNS text
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT CASE WHEN l.blocked_at IS NULL AND l.deleted_at IS NULL THEN 'valid' ELSE 'blocked' END
	  FROM public.labels l
	 WHERE l.code = asked
	   AND l.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "label_state_in_tenant"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "label_state_in_tenant"(text) TO "opengewerk_app";
