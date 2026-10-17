-- A PDF of an evidence with a higher signature, signed outside and filed at
-- the evidence (#341, section 2.6 of the concept; decided on 15.10.2026: only
-- taken). The server checks the file before it writes the row; the database
-- keeps the row as written.
--
-- - `evidence_signed_prints`: SELECT and INSERT for the application, and
--   DELETE, which the lock lets through only for the evidence a transaction
--   empties after the end of its retention (#340, ADR 0004).
-- - The emptying of #340 takes the signed PDFs along.
-- - The change log as at the prints: a row is written unconditionally, its
--   change or removal unless it goes with its evidence.

CREATE TABLE "evidence_signed_prints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"signer" text NOT NULL,
	"issuer" text NOT NULL,
	"signed_at" timestamp with time zone,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"filed_by" text NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_signed_prints_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_signed_prints_signer_shaped" CHECK (length("evidence_signed_prints"."signer") between 1 and 500),
	CONSTRAINT "evidence_signed_prints_issuer_shaped" CHECK (length("evidence_signed_prints"."issuer") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ADD CONSTRAINT "evidence_signed_prints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ADD CONSTRAINT "evidence_signed_prints_follow_their_evidence" FOREIGN KEY ("tenant_id","evidence_id","area_id") REFERENCES "public"."evidence"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ADD CONSTRAINT "evidence_signed_prints_of_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ADD CONSTRAINT "evidence_signed_prints_in_a_file_of_the_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ADD CONSTRAINT "evidence_signed_prints_filed_by_somebody_here" FOREIGN KEY ("tenant_id","filed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_signed_prints_once" ON "evidence_signed_prints" USING btree ("tenant_id","evidence_id","sha256");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence_signed_prints" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("evidence_signed_prints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("evidence_signed_prints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "evidence_signed_prints" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "evidence_signed_prints" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "evidence_signed_prints"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = "evidence_signed_prints"."evidence_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "evidence_signed_prints"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = "evidence_signed_prints"."evidence_id")));--> statement-breakpoint

CREATE FUNCTION "signed_print_kept_as_written"() RETURNS trigger
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

	-- With its evidence after the end of the retention (#340).
	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.evidence_emptying_of(old.evidence_id) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Ein höher signiertes PDF wird nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "evidence_signed_prints"
	FOR EACH ROW EXECUTE FUNCTION "signed_print_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "evidence_signed_prints"
	FOR EACH STATEMENT EXECUTE FUNCTION "signed_print_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "evidence_signed_prints"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "evidence_signed_prints"
	FOR EACH ROW WHEN (NOT public.evidence_emptying_of(old.evidence_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "evidence_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	UPDATE public.evidence
	   SET state = '{"version": 0}'::jsonb,
	       fingerprint = encode(sha256(convert_to('{"version":0}', 'UTF8')), 'hex'),
	       emptied_at = now(),
	       performed_by = NULL,
	       examiner = NULL,
	       examiner_organisation = NULL,
	       contractor_id = NULL,
	       written_by = NULL,
	       result_reason = NULL,
	       replacement_reason = NULL
	 WHERE id = new.evidence_id AND emptied_at IS NULL;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Dieser Nachweis ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	DELETE FROM public.prints WHERE evidence_id = new.evidence_id;
	DELETE FROM public.evidence_signed_prints WHERE evidence_id = new.evidence_id;
	UPDATE public.evidence_voidings SET reason = 'Gelöscht nach Ablauf der Aufbewahrung.' WHERE evidence_id = new.evidence_id;
	UPDATE public.deadlines
	   SET status = 'done', closed_at = now(), closed_by = new.confirmed_by
	 WHERE evidence_id = new.evidence_id AND status = 'open';

	RETURN NULL;
END;
$$;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "evidence_signed_prints" TO "opengewerk_app";
