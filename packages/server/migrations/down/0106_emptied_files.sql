-- Takes back 0106_emptied_files: the prints and the PDFs with a higher
-- signature leave their row in `files` behind again, and a certificate stays
-- with its evidence emptied. What went with an evidence emptied before stays gone.
DROP TRIGGER "signed_prints_take_their_files" ON "evidence_signed_prints";--> statement-breakpoint
DROP TRIGGER "prints_take_their_files" ON "prints";--> statement-breakpoint
DROP FUNCTION "print_takes_its_file"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "application_attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1
		  FROM public.attachments a
		 WHERE a.id = p_attachment
		   AND (public.activity_emptying_of(a.activity_id) OR public.defect_emptying_of(a.defect_id))
	)
$$;--> statement-breakpoint
DROP FUNCTION "certificate_of_an_emptying"(uuid);--> statement-breakpoint
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
