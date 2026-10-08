-- Defects kept from the day they are found to the day they are checked again
-- (#116, section 4.6 of the concept).
--
-- `defects` gets three columns. The evidence of the report a defect was named
-- in (#110): a report without an open activity left a defect that named
-- nothing it came from. The day it was last checked again and what was found
-- then: "nachgeprüft" is a step of its own, and checking it again may also
-- find it not set right. A defect is checked again on the day it was found or
-- later, and none is checked again without that day. No row breaks either:
-- nothing set a defect to "verified" before this.
--
-- A document may hang on a defect: its photo. The check that a document hangs
-- on one record at most takes the defect in, and removing a defect marks its
-- documents like those of every other record (`mark_documents_below`).
--
-- A deadline follows a duty or a defect: the day a defect is to be set right
-- by is a source of the deadline engine (section 2.4). Every deadline before
-- this follows a duty, so the check holds for every row.
--
-- `defect_class_terms` holds the default of each class the operator sets: the
-- days to set a defect of it right in. One row per class that has one;
-- emptying a default deletes its row, which the log keeps.
CREATE TABLE "defect_class_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"defect_class" text NOT NULL,
	"due_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "defect_class_terms_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "defect_class_terms_once" UNIQUE("tenant_id","defect_class"),
	CONSTRAINT "defect_class_terms_class_shaped" CHECK ("defect_class_terms"."defect_class" = btrim("defect_class_terms"."defect_class") and char_length("defect_class_terms"."defect_class") between 1 and 130),
	CONSTRAINT "defect_class_terms_days" CHECK ("defect_class_terms"."due_days" between 1 and 3650)
);
--> statement-breakpoint
ALTER TABLE "defect_class_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_hang_on_one_record";--> statement-breakpoint
ALTER TABLE "deadlines" ALTER COLUMN "duty_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "found_in_evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "checked_on" date;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "check_note" text;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "defect_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "defect_id" uuid;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_place" UNIQUE("tenant_id","id","property_id");--> statement-breakpoint
ALTER TABLE "defect_class_terms" ADD CONSTRAINT "defect_class_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_named_in_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","found_in_evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_defect_of_their_property" FOREIGN KEY ("tenant_id","defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_defect_of_their_property" FOREIGN KEY ("tenant_id","defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadlines_defect_idx" ON "deadlines" USING btree ("tenant_id","defect_id");--> statement-breakpoint
CREATE INDEX "attachments_defect_idx" ON "attachments" USING btree ("tenant_id","defect_id");--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_check_note_shaped" CHECK ("defects"."check_note" is null or ("defects"."check_note" = btrim("defects"."check_note") and char_length("defects"."check_note") between 1 and 1000));--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_checked_after_found" CHECK ("defects"."checked_on" is null or "defects"."checked_on" >= "defects"."found_on");--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_verified_on_a_day" CHECK ("defects"."status" <> 'verified' or "defects"."checked_on" is not null);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id") = 1);--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_hang_on_one_record" CHECK (num_nonnulls("attachments"."building_id", "attachments"."room_id", "attachments"."asset_id", "attachments"."activity_id", "attachments"."defect_id") <= 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "defect_class_terms" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("defect_class_terms"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("defect_class_terms"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "defect_class_terms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "defect_class_terms" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "defect_class_terms"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mark_documents_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'buildings' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'activities' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND activity_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'defects' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND defect_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "mark_documents_below"();
