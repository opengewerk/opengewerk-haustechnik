CREATE TABLE "evidence_voidings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"voided_by" text NOT NULL,
	"voided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_voidings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_voidings_reason_shaped" CHECK ("evidence_voidings"."reason" = btrim("evidence_voidings"."reason") and char_length("evidence_voidings"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "evidence_voidings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "replaces_evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "replacement_reason" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_property_duty_key" UNIQUE("tenant_id","id","property_id","duty_id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_property_key" UNIQUE("tenant_id","id","property_id");--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_of_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_voidings" ADD CONSTRAINT "evidence_voidings_by_somebody_here" FOREIGN KEY ("tenant_id","voided_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_voided_once" ON "evidence_voidings" USING btree ("tenant_id","evidence_id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_replaces_one_of_its_duty" FOREIGN KEY ("tenant_id","replaces_evidence_id","property_id","duty_id") REFERENCES "public"."evidence"("tenant_id","id","property_id","duty_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_replaced_once" ON "evidence" USING btree ("tenant_id","replaces_evidence_id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_replacement_with_a_reason" CHECK (("evidence"."replaces_evidence_id" is null) = ("evidence"."replacement_reason" is null));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_replacement_reason_shaped" CHECK ("evidence"."replacement_reason" is null or ("evidence"."replacement_reason" = btrim("evidence"."replacement_reason") and char_length("evidence"."replacement_reason") between 1 and 500));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_not_its_own_replacement" CHECK ("evidence"."replaces_evidence_id" <> "evidence"."id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence_voidings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("evidence_voidings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("evidence_voidings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "evidence_voidings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "evidence_voidings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "evidence_voidings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "evidence_voidings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

-- No change and no removal of a declaration of invalidity, for any role. The
-- area alone may follow the property, and only from the key: then the trigger
-- runs one level deeper than the statement, and every other column is what it
-- was.
CREATE FUNCTION "voiding_kept_as_written"() RETURNS trigger
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

	RAISE EXCEPTION 'Eine Ungültigerklärung wird nicht geändert und nicht gelöscht. Der Nachweis bleibt mit ihr lesbar.'
		USING ERRCODE = 'HT006';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "voiding_kept_as_written" BEFORE UPDATE OR DELETE ON "evidence_voidings"
	FOR EACH ROW EXECUTE FUNCTION "voiding_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "voiding_kept_whole" BEFORE TRUNCATE ON "evidence_voidings"
	FOR EACH STATEMENT EXECUTE FUNCTION "voiding_kept_as_written"();
