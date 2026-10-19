-- The record of the processing, the technical and organisational measures
-- and the deletion concept as the application makes them (#358, section 9 of
-- the concept, decided on 19.10.2026).
--
-- `privacy_documents`: every one of the three documents the Leitung made,
-- with its kind, its whole text, the version it holds for and the sections
-- that differ from the one of its kind before. Like `processing_descriptions`
-- (0086), each stays with its day: the application may read a row and add
-- one, nothing else.
--
-- `processing_record_settings` and `processing_record_activities`: what the
-- Leitung writes for the record, who is responsible, the data protection
-- officer, and per activity the purpose, the legal basis and the recipients.
-- The application reads, adds and changes them; taking a change back sets
-- purpose and legal basis to null again, so a row is never removed.
--
-- All three tenant-wide and without an area: the policy `tenant_isolation`
-- alone, FORCE. The key onto the memberships is laid on a table without rows,
-- so nothing has to be checked against them. No right is new: "Auskunft,
-- Verfahrensbeschreibung und Verzeichnis erzeugen" came with 0086.
--
-- **Fits the version before it.** That version knows none of the tables.
CREATE TABLE "privacy_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"made_by" text NOT NULL,
	"holds_for" text,
	"text" text NOT NULL,
	"changed" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_documents_kind_known" CHECK ("privacy_documents"."kind" in ('record', 'measures', 'deletion'))
);
--> statement-breakpoint
ALTER TABLE "privacy_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "processing_record_activities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity" text NOT NULL,
	"purpose" text,
	"legal_basis" text,
	"recipients" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_record_activities_once" UNIQUE("tenant_id","activity"),
	CONSTRAINT "processing_record_activities_confirmed_whole" CHECK (("processing_record_activities"."purpose" is null) = ("processing_record_activities"."legal_basis" is null))
);
--> statement-breakpoint
ALTER TABLE "processing_record_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "processing_record_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"controller" text,
	"officer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_record_settings_once" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "processing_record_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "privacy_documents" ADD CONSTRAINT "privacy_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_documents" ADD CONSTRAINT "privacy_documents_made_here" FOREIGN KEY ("tenant_id","made_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_record_activities" ADD CONSTRAINT "processing_record_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_record_settings" ADD CONSTRAINT "processing_record_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_documents_newest" ON "privacy_documents" USING btree ("tenant_id","kind","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "privacy_documents" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("privacy_documents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("privacy_documents"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "processing_record_activities" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("processing_record_activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("processing_record_activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "processing_record_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("processing_record_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("processing_record_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "privacy_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processing_record_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processing_record_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A document is written once and stays.
GRANT SELECT, INSERT ON "privacy_documents" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "processing_record_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "processing_record_activities" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "privacy_documents"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "processing_record_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "processing_record_activities"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
