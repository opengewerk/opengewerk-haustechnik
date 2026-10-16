-- A contractor at work at a work order (#330, section 4.11 of the concept).
--
-- `briefings` holds the briefing of a contractor's person on site: whom, of
-- which firm, in what, the drawing and the moment of the device, taken on the
-- device of whoever leads the order or plans and hands out work, also without
-- a connection. `work_permits` holds a permit for hot work: the form of the
-- package Brandschutz by its key and version and what was entered in it, the
-- signature of whoever carries the work out among it. Who held the device is
-- the person signed in, which the server writes. A briefing belongs to its
-- order and has no deadline of its own.
--
-- Both are written once: the application may read and add a row and nothing
-- else, and a trigger refuses every change but the area that follows the
-- property, for every role, as for a service report. Both tables are new and
-- empty, so their keys need no step out of `FORCE` (#315).

CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"subject" text NOT NULL,
	"path" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"device_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "briefings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "briefings_person_name_shaped" CHECK ("briefings"."person_name" = btrim("briefings"."person_name") and char_length("briefings"."person_name") between 1 and 200),
	CONSTRAINT "briefings_subject_shaped" CHECK ("briefings"."subject" = btrim("briefings"."subject") and char_length("briefings"."subject") between 1 and 2000),
	CONSTRAINT "briefings_path_shaped" CHECK ("briefings"."path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length("briefings"."path") <= 40000),
	CONSTRAINT "briefings_device_info_shaped" CHECK ("briefings"."device_info" is null or ("briefings"."device_info" = btrim("briefings"."device_info") and char_length("briefings"."device_info") between 1 and 500))
);
--> statement-breakpoint
ALTER TABLE "briefings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_permits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"form_key" text NOT NULL,
	"form_version" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"device_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_permits_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_permits_form_shaped" CHECK ("work_permits"."form_key" ~ '^[a-z][a-z0-9_.-]*$' and char_length("work_permits"."form_key") <= 130 and "work_permits"."form_version" >= 1),
	CONSTRAINT "work_permits_answers_shaped" CHECK (jsonb_typeof("work_permits"."answers") = 'object' and octet_length("work_permits"."answers"::text) <= 1000000),
	CONSTRAINT "work_permits_device_info_shaped" CHECK ("work_permits"."device_info" is null or ("work_permits"."device_info" = btrim("work_permits"."device_info") and char_length("work_permits"."device_info") between 1 and 500))
);
--> statement-breakpoint
ALTER TABLE "work_permits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_of_a_contractor_here" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_by_somebody_here" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_of_a_contractor_here" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_by_somebody_here" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefings_activity_idx" ON "briefings" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "briefings_contractor_idx" ON "briefings" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
CREATE INDEX "work_permits_activity_idx" ON "work_permits" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "work_permits_contractor_idx" ON "work_permits" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "briefings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("briefings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("briefings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "briefings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_permits" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_permits"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_permits"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "work_permits" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "briefings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_permits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "briefings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "work_permits" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_permits"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_permits"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal of a briefing or a permit, for any role. The area
-- alone may follow the property, and only from the key: then the trigger runs
-- one level deeper than the statement, and every other column is what it was.
-- It runs before `stamp_sync_columns`, triggers of one kind running in the
-- order of their names, so that the columns of the sync are still the old
-- ones here.
CREATE FUNCTION "visit_kept_as_written"() RETURNS trigger
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

	IF tg_table_name = 'briefings' THEN
		RAISE EXCEPTION 'Eine Einweisung wird nicht geändert und nicht gelöscht. Sie bleibt, wie die eingewiesene Person sie unterschrieben hat.'
			USING ERRCODE = 'HT005';
	END IF;

	RAISE EXCEPTION 'Ein Erlaubnisschein wird nicht geändert und nicht gelöscht. Er bleibt, wie er erteilt wurde.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "visit_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "briefings"
	FOR EACH STATEMENT EXECUTE FUNCTION "visit_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "work_permits"
	FOR EACH ROW EXECUTE FUNCTION "visit_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "work_permits"
	FOR EACH STATEMENT EXECUTE FUNCTION "visit_kept_as_written"();
