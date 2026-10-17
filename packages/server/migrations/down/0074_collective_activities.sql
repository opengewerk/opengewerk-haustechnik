-- Takes back 0074_collective_activities: the emptying of 0073, the trigger and
-- the columns of the collective activities.

CREATE OR REPLACE FUNCTION "evidence_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	activity uuid;
	areas text;
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
	 WHERE id = new.evidence_id AND emptied_at IS NULL
	RETURNING activity_id INTO activity;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Dieser Nachweis ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	DELETE FROM public.prints WHERE evidence_id = new.evidence_id;
	DELETE FROM public.evidence_signed_prints WHERE evidence_id = new.evidence_id;
	UPDATE public.evidence_voidings SET reason = 'Gelöscht nach Ablauf der Aufbewahrung.' WHERE evidence_id = new.evidence_id;
	UPDATE public.deadlines
	   SET status = 'done', closed_at = now(), closed_by = new.confirmed_by
	 WHERE evidence_id = new.evidence_id AND status = 'open';

	IF activity IS NULL THEN
		RETURN NULL;
	END IF;

	-- In every area, and back to what it was afterwards.
	areas := current_setting('app.all_areas', true);
	PERFORM set_config('app.all_areas', 'on', true);

	IF public.activity_emptying_of(activity) THEN
		UPDATE public.activities
		   SET emptied_at = now(),
		       title = 'Gelöscht nach Ablauf der Aufbewahrung',
		       closing_reason = CASE WHEN closing_reason IS NULL THEN NULL ELSE 'Gelöscht nach Ablauf der Aufbewahrung.' END,
		       responsible_user_id = NULL,
		       performer_user_id = NULL,
		       contractor_note = NULL,
		       contractor_id = NULL,
		       device_id = NULL
		 WHERE id = activity AND emptied_at IS NULL;

		UPDATE public.activity_duties
		   SET remark = NULL,
		       result_reason = CASE WHEN result_reason IS NULL THEN NULL ELSE 'Gelöscht nach Ablauf der Aufbewahrung.' END,
		       device_id = NULL
		 WHERE activity_id = activity;
		UPDATE public.work_orders SET device_id = NULL WHERE activity_id = activity;
		UPDATE public.defects SET found_in_answer_id = NULL
		 WHERE found_in_activity_id = activity AND found_in_answer_id IS NOT NULL;

		DELETE FROM public.prints
		 WHERE activity_id = activity
		    OR service_report_id IN (SELECT r.id FROM public.service_reports r WHERE r.activity_id = activity);
		DELETE FROM public.service_report_records
		 WHERE service_report_id IN (SELECT r.id FROM public.service_reports r WHERE r.activity_id = activity);
		DELETE FROM public.service_reports WHERE activity_id = activity;
		DELETE FROM public.round_records WHERE activity_id = activity;
		DELETE FROM public.activity_answers WHERE activity_id = activity;
		DELETE FROM public.activity_signatures WHERE activity_id = activity;
		DELETE FROM public.work_order_decisions
		 WHERE work_order_id IN (SELECT w.id FROM public.work_orders w WHERE w.activity_id = activity);
		DELETE FROM public.work_order_participants WHERE activity_id = activity;
		DELETE FROM public.work_order_notes WHERE activity_id = activity;
		DELETE FROM public.work_order_materials WHERE activity_id = activity;
		DELETE FROM public.briefings WHERE activity_id = activity;
		DELETE FROM public.work_permits WHERE activity_id = activity;
		UPDATE public.attachments SET deleted_at = now() WHERE activity_id = activity AND deleted_at IS NULL;
	END IF;

	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP FUNCTION "empty_the_activity"(uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "activity_emptying_of"(p_activity uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_activity IS NOT NULL
	   AND EXISTS (
		SELECT 1
		  FROM public.evidence e
		  JOIN public.evidence_emptyings c ON c.evidence_id = e.id
		 WHERE e.activity_id = p_activity AND c.confirmed_at = now()
	   )
	   AND NOT EXISTS (
		SELECT 1 FROM public.evidence e WHERE e.activity_id = p_activity AND e.emptied_at IS NULL
	   )
$$;--> statement-breakpoint
DROP TRIGGER "part_of_a_collective" ON "activities";--> statement-breakpoint
DROP FUNCTION "part_of_a_collective"();--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_parts_of_inspections";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_collective_holds_parts";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_collective_kind_shaped";--> statement-breakpoint
DROP INDEX "activities_collective_idx";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_part_of_a_collective";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "collective_kind";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "collective_id";
