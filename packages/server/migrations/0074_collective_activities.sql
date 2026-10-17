-- Collective activities (#342, section 4.4 of the concept, ADR 0002,
-- addendum of 17.10.2026): an inspection or a maintenance that holds a part
-- for each of its duties, made by the office from a duty kind and a place.
--
-- - `collective_kind` makes an activity a collective one: the key of the duty
--   kind, without a form, an asset or duties of its own.
-- - `collective_id` makes an activity a part of one, on the same property and
--   of the same kind, as the key says; that the activity it names is a
--   collective one says the trigger `part_of_a_collective`.
-- - The signature is given at the collective activity, and each part writes
--   the evidence of its duty. When the last evidence of its parts is emptied
--   after the end of the retention (#409), the collective activity becomes a
--   shell as well, with its signatures gone.

ALTER TABLE "activities" ADD COLUMN "collective_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "collective_kind" text;--> statement-breakpoint
-- A key onto a table with rows is checked past the policies of the owner,
-- who migrates (#315): under FORCE it would see only what they show.
ALTER TABLE "activities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_part_of_a_collective" FOREIGN KEY ("tenant_id","collective_id","property_id","kind") REFERENCES "public"."activities"("tenant_id","id","property_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "activities_collective_idx" ON "activities" USING btree ("tenant_id","collective_id") WHERE "activities"."collective_id" is not null;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_collective_kind_shaped" CHECK ("activities"."collective_kind" is null or ("activities"."collective_kind" ~ '^[a-z][a-z0-9_.-]*$' and char_length("activities"."collective_kind") <= 130));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_collective_holds_parts" CHECK ("activities"."collective_kind" is null or ("activities"."kind" in ('inspection', 'maintenance') and "activities"."form_key" is null and "activities"."asset_id" is null and "activities"."collective_id" is null));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_parts_of_inspections" CHECK ("activities"."collective_id" is null or "activities"."kind" in ('inspection', 'maintenance'));--> statement-breakpoint

-- A part names a collective activity, and nothing else.
CREATE FUNCTION "part_of_a_collective"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.collective_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM public.activities a WHERE a.id = new.collective_id AND a.collective_kind IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Ein Vorgang ist nur Teil eines Sammelvorgangs.' USING ERRCODE = 'HT011';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "part_of_a_collective" BEFORE INSERT OR UPDATE OF "collective_id" ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "part_of_a_collective"();--> statement-breakpoint

-- The evidence an activity is emptied with: its own and, for a collective
-- activity, the evidence of its parts.
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
		 WHERE (e.activity_id = p_activity
		        OR e.activity_id IN (SELECT a.id FROM public.activities a WHERE a.collective_id = p_activity))
		   AND c.confirmed_at = now()
	   )
	   AND NOT EXISTS (
		SELECT 1
		  FROM public.evidence e
		 WHERE (e.activity_id = p_activity
		        OR e.activity_id IN (SELECT a.id FROM public.activities a WHERE a.collective_id = p_activity))
		   AND e.emptied_at IS NULL
	   )
$$;--> statement-breakpoint

-- The shell of an activity (#409), for the activity of an evidence and for
-- the collective activity of a part alike.
CREATE FUNCTION "empty_the_activity"(p_activity uuid) RETURNS void
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

-- The emptying of #340 and #409, and after a part its collective activity
-- when that was the last evidence of its parts.
CREATE OR REPLACE FUNCTION "evidence_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	activity uuid;
	collective uuid;
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
		PERFORM public.empty_the_activity(activity);

		SELECT a.collective_id INTO collective FROM public.activities a WHERE a.id = activity;

		IF collective IS NOT NULL AND public.activity_emptying_of(collective) THEN
			PERFORM public.empty_the_activity(collective);
		END IF;
	END IF;

	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

	RETURN NULL;
END;
$$;
