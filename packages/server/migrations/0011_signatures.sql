-- The signature on an activity and the decision on a work order (ADR 0004,
-- points 7, 8 and 10, section 4.8 of the concept, opengewerk-haustechnik#26).
--
-- An activity carries the day it was performed on and whether its template
-- asks for a countersignature; a work order is accepted instead and never
-- countersigned. Each duty of an activity carries what came of it, the result
-- with the reason of a "not performed", entered while the activity is
-- performed, and one evidence per duty comes of it when the activity is
-- written down.
--
-- A signature is made on the device, also without a connection, with the
-- moment of the device, the drawing and the fingerprint of the page that was
-- shown; the server takes it only for the page it works out itself. The
-- acceptance of a signed work order, or its rejection with the reason, is a
-- row of its own; a rejection leaves the signature standing and invalid.
-- Both are written once: the application may read and add a row and nothing
-- else, and a trigger refuses a change, a removal and a TRUNCATE to every role,
-- with the one exception of the area that follows its property by the key. The
-- trigger is named so that it runs before `stamp_sync_columns`, which would
-- otherwise have changed the columns of the sync by the time it compares.
--
-- Every row carries the property and the area of its place, kept by the key
-- over (tenant_id, property_id, area_id) with ON UPDATE CASCADE, and the
-- restrictive policy `within_areas` (ADR 0003). Both tables carry the columns
-- of the sync; what a device may write comes with the rules of the sync (#27).
--
-- Everything from the two types down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks these tables and
-- columns, and creating them changes no row anywhere else.

CREATE TYPE "public"."signature_role" AS ENUM('signer', 'countersigner');--> statement-breakpoint
CREATE TYPE "public"."work_order_decision" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "activity_signatures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"signed_by" text NOT NULL,
	"role" "signature_role" NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"device_info" text,
	"path" text NOT NULL,
	"page_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_signatures_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "activity_signatures_path_shaped" CHECK ("activity_signatures"."path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length("activity_signatures"."path") <= 40000),
	CONSTRAINT "activity_signatures_device_info_shaped" CHECK ("activity_signatures"."device_info" is null or char_length("activity_signatures"."device_info") <= 500),
	CONSTRAINT "activity_signatures_page_fingerprint_shaped" CHECK ("activity_signatures"."page_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "activity_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_order_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"decision" "work_order_decision" NOT NULL,
	"reason" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_order_decisions_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_order_decisions_reason_shaped" CHECK ("work_order_decisions"."reason" is null or ("work_order_decisions"."reason" = btrim("work_order_decisions"."reason") and char_length("work_order_decisions"."reason") between 1 and 500)),
	CONSTRAINT "work_order_decisions_rejected_with_a_reason" CHECK (("work_order_decisions"."decision" = 'rejected') = ("work_order_decisions"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "work_order_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "performed_on" date;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "countersignature_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD COLUMN "result" "evidence_result";--> statement-breakpoint
ALTER TABLE "activity_duties" ADD COLUMN "result_reason" text;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_by_somebody_here" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","work_order_id","property_id") REFERENCES "public"."work_orders"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_decisions" ADD CONSTRAINT "work_order_decisions_by_somebody_here" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_signatures_activity_idx" ON "activity_signatures" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "work_order_decisions_work_order_idx" ON "work_order_decisions" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_countersigned_but_no_work_order" CHECK ("activities"."kind" <> 'work_order' or not "activities"."countersignature_required");--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_result_reason_shaped" CHECK ("activity_duties"."result_reason" is null or ("activity_duties"."result_reason" = btrim("activity_duties"."result_reason") and char_length("activity_duties"."result_reason") between 1 and 500));--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_not_performed_with_a_reason" CHECK (("activity_duties"."result" is not distinct from 'not_performed') = ("activity_duties"."result_reason" is not null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activity_signatures" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("activity_signatures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("activity_signatures"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "activity_signatures" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_order_decisions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_order_decisions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_order_decisions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "work_order_decisions" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "activity_signatures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "activity_signatures" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "work_order_decisions" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_signatures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_decisions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "activity_signatures"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_order_decisions"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal, for any role. The area alone may follow the
-- property, and only from the key: then the trigger runs one level deeper than
-- the statement, and every other column is what it was. It runs before
-- `stamp_sync_columns`, triggers of one kind running in the order of their
-- names, so that the columns of the sync are still the old ones here.
CREATE FUNCTION "kept_as_written"() RETURNS trigger
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

	IF tg_table_name = 'activity_signatures' THEN
		RAISE EXCEPTION 'Eine Unterschrift wird nicht geändert und nicht gelöscht. Wird ein Auftrag zurückgewiesen, bleibt sie stehen und gilt nicht mehr.'
			USING ERRCODE = 'HT005';
	END IF;

	RAISE EXCEPTION 'Eine Abnahme oder Zurückweisung wird nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "activity_signatures"
	FOR EACH ROW EXECUTE FUNCTION "kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "activity_signatures"
	FOR EACH STATEMENT EXECUTE FUNCTION "kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "work_order_decisions"
	FOR EACH ROW EXECUTE FUNCTION "kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "work_order_decisions"
	FOR EACH STATEMENT EXECUTE FUNCTION "kept_as_written"();
