-- Back to how 0098 left things: an emptied activity marks its documents as
-- removed again, no document and no file goes for good, the versions keep
-- their lock of before, the log hangs on the two tables as one trigger again,
-- and who stored a file stops the file from going.
--
-- Run as the superuser, like every rollback.
CREATE OR REPLACE FUNCTION "empty_the_activity"(p_activity uuid) RETURNS void
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	UPDATE public.activities
	   SET emptied_at = now(),
	       title = 'Gelöscht nach Ablauf der Aufbewahrung',
	       closing_reason = CASE WHEN closing_reason IS NULL THEN NULL ELSE 'Gelöscht nach Ablauf der Aufbewahrung.' END,
	       responsible_user_id = NULL,
	       performer_user_id = NULL,
	       contractor_note = NULL,
	       contractor_id = NULL,
	       device_id = NULL
	 WHERE id = p_activity AND emptied_at IS NULL;

	UPDATE public.activity_duties
	   SET remark = NULL,
	       result_reason = CASE WHEN result_reason IS NULL THEN NULL ELSE 'Gelöscht nach Ablauf der Aufbewahrung.' END,
	       device_id = NULL
	 WHERE activity_id = p_activity;
	UPDATE public.work_orders SET device_id = NULL WHERE activity_id = p_activity;
	UPDATE public.defects SET found_in_answer_id = NULL
	 WHERE found_in_activity_id = p_activity AND found_in_answer_id IS NOT NULL;

	DELETE FROM public.prints
	 WHERE activity_id = p_activity
	    OR service_report_id IN (SELECT r.id FROM public.service_reports r WHERE r.activity_id = p_activity);
	DELETE FROM public.service_report_records
	 WHERE service_report_id IN (SELECT r.id FROM public.service_reports r WHERE r.activity_id = p_activity);
	DELETE FROM public.service_reports WHERE activity_id = p_activity;
	DELETE FROM public.round_records WHERE activity_id = p_activity;
	DELETE FROM public.activity_answers WHERE activity_id = p_activity;
	DELETE FROM public.activity_signatures WHERE activity_id = p_activity;
	DELETE FROM public.work_order_decisions
	 WHERE work_order_id IN (SELECT w.id FROM public.work_orders w WHERE w.activity_id = p_activity);
	DELETE FROM public.work_order_participants WHERE activity_id = p_activity;
	DELETE FROM public.work_order_notes WHERE activity_id = p_activity;
	DELETE FROM public.work_order_materials WHERE activity_id = p_activity;
	DELETE FROM public.briefings WHERE activity_id = p_activity;
	DELETE FROM public.work_permits WHERE activity_id = p_activity;
	UPDATE public.attachments SET deleted_at = now() WHERE activity_id = p_activity AND deleted_at IS NULL;
END;
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "application_attachment_may_go"(uuid);--> statement-breakpoint
DROP TRIGGER IF EXISTS "files_go_with_their_document" ON "files";--> statement-breakpoint
DROP TRIGGER IF EXISTS "attachment_versions_take_their_files" ON "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes_unless_purged" ON "attachment_versions";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "attachment_versions";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachment_versions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes_unless_purged" ON "attachments";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_changes" ON "attachments";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
REVOKE DELETE ON "attachment_versions" FROM "opengewerk_app";--> statement-breakpoint
DROP POLICY IF EXISTS "deletable_by_the_owner" ON "files";--> statement-breakpoint
DROP FUNCTION IF EXISTS "purge_attachment"(uuid, text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "version_takes_its_files"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "file_goes_with_its_document"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "attachment_version_stays_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Fassung einer Datei wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG001';
END;
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_purging"(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "attachment_may_go"(uuid);--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT "file_uploads_file_in_tenant";--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;
