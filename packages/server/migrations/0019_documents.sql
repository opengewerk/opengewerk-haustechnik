-- The documents of an operator with their versions (section 4.10 of the
-- concept, opengewerk-haustechnik#97): the files of the foundation (ADR 0010
-- of the repository opengewerk), with what a document hangs on here.
--
-- What a file is and what a version of it is are the columns of the
-- foundation: a name, and on each version the hash, the name, the type and
-- the size of the file it stands for, the hash of a preview, and who stored
-- it. What a document hangs on is this application's: its property always,
-- and at most one record there, a building, a room, an asset or an activity,
-- each under a key over the tenant and the property; and its kind, one of the
-- six of the concept or none.
--
-- A document carries the area of its property, kept by the key over
-- (tenant_id, property_id, area_id) with ON UPDATE CASCADE, and the
-- restrictive policy `within_areas` (ADR 0003). A version carries none: it is
-- written once and a trigger of the foundation refuses every change to it, so
-- an area on the row could not follow its property into another area. It asks
-- its document instead, by the restrictive policy `within_areas_of_their_file`
-- (ADR 0003, addendum of #97): a version is in reach of whoever its document
-- is in reach of, and a version is added only to a document the person sees.
--
-- The rows travel to a device. Deleting marks a document: the application
-- role has no DELETE, and a trigger marks the documents of a record that is
-- marked, at the same moment. A version is read and inserted and nothing else.
--
-- The two functions at the top are the building block `attachments.sql` of
-- the foundation, which comes with the commit of the foundation this
-- migration follows; the comparison with the building blocks reads their
-- definitions. Everything from the type down to the policies is what
-- drizzle-kit generated from the schema. What follows the policies is written
-- by hand.
--
-- **Fits the version before it.** That version never asks these tables, and
-- nothing it writes is changed.

-- Who stored the version, from the request and from nothing else: who and
-- when is what the metadata of a file has to say.
CREATE FUNCTION "record_attachment_uploader"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.created_by := nullif(current_setting('app.user_id', true), '');

	RETURN new;
END;
$$;--> statement-breakpoint

-- Refuses every change and every deletion, whoever asks. A version whose hash
-- could be changed afterwards would show somebody a different file than the
-- one a decision was taken on.
CREATE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Fassung einer Datei wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('operating_manual', 'test_certificate', 'circuit_diagram', 'as_built_documentation', 'permit', 'concept');--> statement-breakpoint
CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"preview_sha256" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "attachment_versions_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "attachment_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"asset_id" uuid,
	"activity_id" uuid,
	"kind" "document_kind",
	CONSTRAINT "attachments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attachments_hang_on_one_record" CHECK (num_nonnulls("attachments"."building_id", "attachments"."room_id", "attachments"."asset_id", "attachments"."activity_id") <= 1),
	CONSTRAINT "attachments_title_shaped" CHECK ("attachments"."title" = btrim("attachments"."title") and char_length("attachments"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_in_tenant" FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "public"."attachments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_preview_in_tenant" FOREIGN KEY ("tenant_id","preview_sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_versions_attachment_idx" ON "attachment_versions" USING btree ("tenant_id","attachment_id");--> statement-breakpoint
CREATE INDEX "attachments_property_idx" ON "attachments" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "attachments_asset_idx" ON "attachments" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "attachments_activity_idx" ON "attachments" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachment_versions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("attachment_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("attachment_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas_of_their_file" ON "attachment_versions" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (EXISTS (SELECT 1 FROM attachments WHERE attachments.tenant_id = attachment_versions.tenant_id AND attachments.id = attachment_versions.attachment_id)) WITH CHECK (EXISTS (SELECT 1 FROM attachments WHERE attachments.tenant_id = attachment_versions.tenant_id AND attachments.id = attachment_versions.attachment_id));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachments" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("attachments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("attachments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "attachments" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "attachments" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
ALTER TABLE "attachment_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "attachment_versions" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "attachment_versions_record_uploader" BEFORE INSERT ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_attachment_uploader"();--> statement-breakpoint
CREATE TRIGGER "attachment_versions_stay_as_written" BEFORE UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "attachment_version_stays_as_written"();--> statement-breakpoint

-- The documents of a marked record are marked with it, at the same moment: a
-- document of an asset that is gone is no longer handed out, and a device
-- that holds it hears that it may let it go. A property takes every document
-- on it along, whatever that hangs on; a building, a room, an asset and an
-- activity take their own. Only the step from live to deleted: nothing here
-- brings a row back. The versions stay as they are, with their bytes.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: a document has
-- the area of its property, so whoever may mark the record sees its
-- documents. The statement names the tenant.
CREATE FUNCTION "mark_documents_below"() RETURNS trigger
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
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_documents_below"();--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_documents_below"();--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "mark_documents_below"();--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_documents_below"();--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "mark_documents_below"();
