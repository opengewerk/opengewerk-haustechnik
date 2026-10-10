-- The frozen state of a round and the PDF made of a frozen state (#111,
-- section 2.6 of the concept).
--
-- `round_records` holds the frozen state of a round as a whole, written once
-- when the round is written down: every answer, the photos by their hash, the
-- defects that came of it, the signatures with their drawings and the
-- evidence it was written down with, with the fingerprint over it. A round
-- that meets no duty has no evidence, and this is what its PDF is made of.
-- `prints` holds the PDF of an evidence or a round, made from the frozen state
-- the first time somebody asks for it and kept in the content addressed store
-- under its hash, so that it is the same file byte for byte every time after.
-- An evidence declared invalid afterwards is printed once more, with the
-- declaration on it. Neither table is changed or emptied by anybody; the area
-- alone follows the property, from the key.

CREATE TABLE "prints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"evidence_id" uuid,
	"activity_id" uuid,
	"voided" boolean DEFAULT false NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prints_of_one_record" CHECK (num_nonnulls("prints"."evidence_id", "prints"."activity_id") = 1),
	CONSTRAINT "prints_voided_evidence" CHECK (not "prints"."voided" or "prints"."evidence_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "prints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "round_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_records_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "round_records_once" UNIQUE("tenant_id","activity_id"),
	CONSTRAINT "round_records_fingerprint_shaped" CHECK ("round_records"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "round_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_in_a_file_of_the_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prints_of_an_evidence_once" ON "prints" USING btree ("tenant_id","evidence_id","voided");--> statement-breakpoint
CREATE UNIQUE INDEX "prints_of_a_round_once" ON "prints" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prints" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("prints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("prints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "prints" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "round_records" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("round_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("round_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "round_records" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "round_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "round_records" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "prints" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "round_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "prints"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- No change and no removal, for any role, as for an evidence. The area alone
-- may follow the property, and only from the key: then the trigger runs one
-- level deeper than the statement, and every other column is what it was.
CREATE FUNCTION "print_kept_as_written"() RETURNS trigger
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

	RAISE EXCEPTION 'Ein eingefrorener Stand und sein PDF werden nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "round_records"
	FOR EACH ROW EXECUTE FUNCTION "print_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "round_records"
	FOR EACH STATEMENT EXECUTE FUNCTION "print_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "prints"
	FOR EACH ROW EXECUTE FUNCTION "print_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "prints"
	FOR EACH STATEMENT EXECUTE FUNCTION "print_kept_as_written"();
