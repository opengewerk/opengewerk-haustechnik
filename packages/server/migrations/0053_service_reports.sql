-- The service report of a work order (#324, section 4.8 of the concept).
--
-- `service_reports` holds the client's signature under the report, taken on
-- the device of whoever finishes the order, also without a connection: the
-- name in block letters, the drawing, the moment of the device and the
-- fingerprint of the page that was shown. Who held the device is the person
-- signed in, which the server writes, and the signature of that account
-- covers the page (2.6). `service_report_records` holds the frozen state the
-- server writes in the same transaction, what the PDF is made of; it does not
-- travel. `work_order_settings` holds whether the report names the people who
-- did the work and the times of their notes, one row per operator, off unless
-- it says otherwise; every device holds it. `prints` gains the service report
-- as a third record a PDF is of, and like an evidence it is printed once more
-- when a rejection made it invalid.
--
-- A report and its frozen state are written once: the application may read
-- and add a row and nothing else, and a trigger refuses every change but the
-- area that follows the property, for every role. The key of `prints` onto
-- `service_reports` is checked with `prints` out of `FORCE` for the one
-- statement, as 0051 does for its keys (#315); every existing print names no
-- report.

CREATE TABLE "service_report_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"service_report_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_report_records_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_report_records_once" UNIQUE("tenant_id","service_report_id"),
	CONSTRAINT "service_report_records_fingerprint_shaped" CHECK ("service_report_records"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "service_report_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"path" text NOT NULL,
	"signed_by" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"device_info" text,
	"page_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "service_reports_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_reports_area_key" UNIQUE("tenant_id","id","area_id"),
	CONSTRAINT "service_reports_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "service_reports_client_name_shaped" CHECK ("service_reports"."client_name" = btrim("service_reports"."client_name") and char_length("service_reports"."client_name") between 1 and 200),
	CONSTRAINT "service_reports_path_shaped" CHECK ("service_reports"."path" ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length("service_reports"."path") <= 40000),
	CONSTRAINT "service_reports_device_info_shaped" CHECK ("service_reports"."device_info" is null or ("service_reports"."device_info" = btrim("service_reports"."device_info") and char_length("service_reports"."device_info") between 1 and 500)),
	CONSTRAINT "service_reports_page_fingerprint_shaped" CHECK ("service_reports"."page_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "service_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_order_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"names_and_times" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_order_settings_once" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "work_order_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_of_one_record";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_voided_evidence";--> statement-breakpoint
ALTER TABLE "prints" ADD COLUMN "service_report_id" uuid;--> statement-breakpoint
ALTER TABLE "service_report_records" ADD CONSTRAINT "service_report_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report_records" ADD CONSTRAINT "service_report_records_follow_their_report" FOREIGN KEY ("tenant_id","service_report_id","area_id") REFERENCES "public"."service_reports"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_report_records" ADD CONSTRAINT "service_report_records_of_a_report_of_their_property" FOREIGN KEY ("tenant_id","service_report_id","property_id") REFERENCES "public"."service_reports"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_by_somebody_here" FOREIGN KEY ("tenant_id","signed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_settings" ADD CONSTRAINT "work_order_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_reports_activity_idx" ON "service_reports" USING btree ("tenant_id","activity_id");--> statement-breakpoint
ALTER TABLE "prints" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_follow_their_service_report" FOREIGN KEY ("tenant_id","service_report_id","area_id") REFERENCES "public"."service_reports"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "prints_of_a_service_report_once" ON "prints" USING btree ("tenant_id","service_report_id","voided");--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_one_record" CHECK (num_nonnulls("prints"."evidence_id", "prints"."activity_id", "prints"."service_report_id") = 1);--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_voided_evidence" CHECK (not "prints"."voided" or "prints"."evidence_id" is not null or "prints"."service_report_id" is not null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_report_records" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("service_report_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("service_report_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "service_report_records" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_reports" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("service_reports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("service_reports"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "service_reports" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_order_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("work_order_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("work_order_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "service_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_report_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_order_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "service_reports" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "service_report_records" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "work_order_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "service_reports"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "service_report_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "service_reports"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "work_order_settings"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal of a report, for any role, as for a signature. The
-- area alone may follow the property, and only from the key: then the trigger
-- runs one level deeper than the statement, and every other column is what it
-- was. It runs before `stamp_sync_columns`, triggers of one kind running in
-- the order of their names, so that the columns of the sync are still the old
-- ones here.
CREATE FUNCTION "service_report_kept_as_written"() RETURNS trigger
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

	RAISE EXCEPTION 'Ein Leistungsnachweis wird nicht geändert und nicht gelöscht. Wird der Auftrag zurückgewiesen, bleibt er stehen und gilt nicht mehr.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "service_reports"
	FOR EACH ROW EXECUTE FUNCTION "service_report_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "service_reports"
	FOR EACH STATEMENT EXECUTE FUNCTION "service_report_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "service_report_records"
	FOR EACH ROW EXECUTE FUNCTION "print_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "service_report_records"
	FOR EACH STATEMENT EXECUTE FUNCTION "print_kept_as_written"();
