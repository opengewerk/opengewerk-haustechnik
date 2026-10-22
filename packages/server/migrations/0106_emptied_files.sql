-- What goes with an evidence after its retention (#522, ADR 0004, addendum
-- of #340, point 5, section 2.6 of the concept): its prints and its PDFs with
-- a higher signature take their row in `files` with them, as a version of a
-- document does since 0099, unless something else still names the bytes; the
-- sweep of the store (0098) then takes the bytes. The same holds for the
-- prints of an activity emptied with its last evidence (#409).
--
-- The certificate of a report (#110), filed as a document at the place of
-- its duty, goes for good with the evidence that names its file (#552),
-- before the evidence lets go of the name, unless an evidence that stays
-- names the file as well.
CREATE FUNCTION "print_takes_its_file"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
BEGIN
	PERFORM set_config('app.taking_file', old.tenant_id::text || '/' || old.sha256, true);

	BEGIN
		DELETE FROM public.files WHERE tenant_id = old.tenant_id AND sha256 = old.sha256;
	EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
		-- Another record still names the file, and it stays.
		NULL;
	END;

	PERFORM set_config('app.taking_file', '', true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "prints_take_their_files" AFTER DELETE ON "prints"
	FOR EACH ROW EXECUTE FUNCTION "print_takes_its_file"();--> statement-breakpoint
CREATE TRIGGER "signed_prints_take_their_files" AFTER DELETE ON "evidence_signed_prints"
	FOR EACH ROW EXECUTE FUNCTION "print_takes_its_file"();--> statement-breakpoint

-- Whether a document is the certificate of an evidence emptied in this very
-- transaction: of the kind "Prüfbescheinigung", one of its versions names a
-- file the evidence names, and no evidence that stays names it.
CREATE FUNCTION "certificate_of_an_emptying"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1
		  FROM public.attachments a
		  JOIN public.attachment_versions v ON v.tenant_id = a.tenant_id AND v.attachment_id = a.id
		  JOIN public.evidence_emptyings c ON c.tenant_id = a.tenant_id AND c.confirmed_at = now()
		  JOIN public.evidence e ON e.tenant_id = c.tenant_id AND e.id = c.evidence_id AND e.emptied_at IS NULL
		 WHERE a.id = p_attachment
		   AND a.kind = 'test_certificate'
		   AND v.sha256 IN (SELECT f.value ->> 'sha256' FROM jsonb_array_elements(e.state -> 'files') AS f)
	)
	AND NOT EXISTS (
		SELECT 1
		  FROM public.attachment_versions v
		  JOIN public.evidence o ON o.tenant_id = v.tenant_id AND o.emptied_at IS NULL
		 WHERE v.attachment_id = p_attachment
		   AND NOT public.evidence_emptying_of(o.id)
		   AND v.sha256 IN (SELECT f.value ->> 'sha256' FROM jsonb_array_elements(o.state -> 'files') AS f)
	)
$$;--> statement-breakpoint

-- Its certificate goes for good as the documents of an activity and the
-- photos of a defect do (0099, 0101).
CREATE OR REPLACE FUNCTION "application_attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1
		  FROM public.attachments a
		 WHERE a.id = p_attachment
		   AND (public.activity_emptying_of(a.activity_id)
		        OR public.defect_emptying_of(a.defect_id)
		        OR public.certificate_of_an_emptying(a.id))
	)
$$;--> statement-breakpoint

-- The emptying of #340 and #409 as in 0074, with the certificate first,
-- while the evidence still names its file.
CREATE OR REPLACE FUNCTION "evidence_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	activity uuid;
	collective uuid;
	areas text := current_setting('app.all_areas', true);
BEGIN
	PERFORM set_config('app.all_areas', 'on', true);
	PERFORM public.purge_attachment(a.id, 'Gelöscht nach Ablauf der Aufbewahrung')
	   FROM public.attachments a
	  WHERE a.tenant_id = new.tenant_id
	    AND a.kind = 'test_certificate'
	    AND public.certificate_of_an_emptying(a.id);
	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

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
