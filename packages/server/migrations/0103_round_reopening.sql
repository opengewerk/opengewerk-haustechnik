-- A handed-in round opened again (#510, section 4.5 of the concept, decided
-- on 21.10.2026; ADR 0004, addendum of 21.10.2026).
--
-- - The activity holds when it was last opened again (`reopened_at`), and
--   only the signatures the server took after it count. The signature before
--   stays as it was written, as after a rejected work order.
-- - Setting it is the one way to open a round again, and the database checks
--   it: a round, no collective activity and no part of one, signed or done,
--   not emptied, without a countersignature since it was last opened, without
--   a defect from its answers that has a work order and without an evidence
--   that still counts. Who may open it the server checks.
-- - With it the defects the signature made of the answers and the readings it
--   wrote are marked removed, in every area; the next signature makes them
--   anew. The lock of the readings lets exactly that through.
-- - A round is written down once per handing in: the record of the signature
--   before stays, and a further one is taken only after an opening.
--
-- **Fits the version before it.** It writes the new column only on the new
-- way, and the record of a round stays one until a round is opened again.

ALTER TABLE "round_records" DROP CONSTRAINT "round_records_once";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "round_records_activity_idx" ON "round_records" USING btree ("tenant_id","activity_id");--> statement-breakpoint

-- True for an activity opened again in this transaction, for the locks that
-- let through what the opening removes.
CREATE FUNCTION "activity_reopening_of"(p_activity uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_activity IS NOT NULL
	   AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = p_activity AND a.reopened_at = now())
$$;--> statement-breakpoint

-- Before a round is opened again: what the opening asks for, looked for in
-- every area, since a defect or an evidence of the round may lie in another.
-- The moment is the database's.
CREATE FUNCTION "activity_reopened"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	areas text := current_setting('app.all_areas', true);
	since timestamptz := coalesce(old.reopened_at, '-infinity');
	refusal text;
BEGIN
	IF new.reopened_at IS NULL THEN
		RAISE EXCEPTION 'Dass ein Rundgang wieder geöffnet wurde, wird nicht zurückgenommen.' USING ERRCODE = 'HT017';
	END IF;

	IF old.kind <> 'round' OR old.collective_id IS NOT NULL OR old.collective_kind IS NOT NULL THEN
		RAISE EXCEPTION 'Wieder geöffnet wird nur ein Rundgang.' USING ERRCODE = 'HT017';
	END IF;

	IF old.status NOT IN ('signed', 'done') OR new.status <> 'started'
	   OR old.emptied_at IS NOT NULL OR old.deleted_at IS NOT NULL THEN
		RAISE EXCEPTION 'Wieder geöffnet wird ein Rundgang, der abgegeben ist.' USING ERRCODE = 'HT017';
	END IF;

	PERFORM set_config('app.all_areas', 'on', true);

	IF EXISTS (
		SELECT 1
		  FROM public.activity_signatures s
		 WHERE s.activity_id = old.id
		   AND s.role = 'countersigner'
		   AND s.created_at > since
	) THEN
		refusal := 'Ein gegengezeichneter Rundgang wird nicht wieder geöffnet. Berichtigt oder für ungültig erklärt wird sein Nachweis.';
	ELSIF EXISTS (
		SELECT 1
		  FROM public.defects d
		 WHERE d.found_in_activity_id = old.id
		   AND d.found_in_answer_id IS NOT NULL
		   AND d.deleted_at IS NULL
		   AND d.remedy_work_order_id IS NOT NULL
	) THEN
		refusal := 'Ein Mangel aus diesem Rundgang hat einen Auftrag. Der Rundgang wird nicht wieder geöffnet.';
	ELSIF EXISTS (
		SELECT 1
		  FROM public.evidence e
		 WHERE e.activity_id = old.id
		   AND NOT EXISTS (SELECT 1 FROM public.evidence_voidings v WHERE v.evidence_id = e.id)
		   AND NOT EXISTS (SELECT 1 FROM public.evidence r WHERE r.replaces_evidence_id = e.id)
	) THEN
		refusal := 'Ein Nachweis aus diesem Rundgang gilt noch. Er wird mit dem Öffnen für ungültig erklärt.';
	END IF;

	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

	IF refusal IS NOT NULL THEN
		RAISE EXCEPTION '%', refusal USING ERRCODE = 'HT017';
	END IF;

	new.reopened_at := now();

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_reopened" BEFORE UPDATE ON "activities"
	FOR EACH ROW WHEN (new.reopened_at IS DISTINCT FROM old.reopened_at)
	EXECUTE FUNCTION "activity_reopened"();--> statement-breakpoint

-- After it is opened: what the signature made of the answers goes, in every
-- area. A defect reported in the round by hand stays, as does every answer.
CREATE FUNCTION "activity_reopening_removes"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	areas text := current_setting('app.all_areas', true);
BEGIN
	PERFORM set_config('app.all_areas', 'on', true);

	UPDATE public.defects
	   SET deleted_at = now()
	 WHERE found_in_activity_id = new.id
	   AND found_in_answer_id IS NOT NULL
	   AND deleted_at IS NULL;

	UPDATE public.meter_readings
	   SET deleted_at = now()
	 WHERE activity_id = new.id
	   AND deleted_at IS NULL;

	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_reopening_removes" AFTER UPDATE ON "activities"
	FOR EACH ROW WHEN (new.reopened_at IS DISTINCT FROM old.reopened_at)
	EXECUTE FUNCTION "activity_reopening_removes"();--> statement-breakpoint

-- The answers are locked by the signatures that count: those after the last
-- opening (#510), and of a work order those after its last rejection.
CREATE OR REPLACE FUNCTION "answers_kept_once_signed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	tenant uuid;
	activity uuid;
BEGIN
	IF tg_op = 'TRUNCATE' THEN
		RAISE EXCEPTION 'Die Antworten werden nicht geleert.'
			USING ERRCODE = 'HT007';
	END IF;

	-- Deleted only with the activity after the end of the retention (#409);
	-- otherwise an answer is marked removed.
	IF tg_op = 'DELETE' THEN
		IF pg_trigger_depth() > 1 AND public.activity_emptying_of(old.activity_id) THEN
			RETURN old;
		END IF;

		RAISE EXCEPTION 'Eine Antwort wird nicht gelöscht.'
			USING ERRCODE = 'HT007';
	END IF;

	IF tg_op = 'UPDATE' THEN
		IF pg_trigger_depth() > 1
		   AND old.area_id IS DISTINCT FROM new.area_id
		   AND (to_jsonb(new) - 'area_id') = (to_jsonb(old) - 'area_id') THEN
			RETURN new;
		END IF;
	END IF;

	IF tg_op = 'UPDATE'
	   AND (old.tenant_id, old.activity_id) IS DISTINCT FROM (new.tenant_id, new.activity_id) THEN
		RAISE EXCEPTION 'Eine Antwort bleibt bei ihrem Vorgang.'
			USING ERRCODE = 'HT007';
	END IF;

	tenant := new.tenant_id;
	activity := new.activity_id;

	IF EXISTS (
		SELECT 1
		  FROM public.activity_signatures s
		 WHERE s.tenant_id = tenant
		   AND s.activity_id = activity
		   AND s.created_at > coalesce(
			(SELECT a.reopened_at FROM public.activities a WHERE a.tenant_id = s.tenant_id AND a.id = s.activity_id),
			'-infinity'
		   )
		   AND NOT EXISTS (
			SELECT 1
			  FROM public.work_order_decisions d
			  JOIN public.work_orders w ON w.tenant_id = d.tenant_id AND w.id = d.work_order_id
			 WHERE w.tenant_id = s.tenant_id
			   AND w.activity_id = s.activity_id
			   AND d.decision = 'rejected'
			   AND d.created_at > s.created_at
		   )
	) THEN
		RAISE EXCEPTION 'Nach der Unterschrift ändert sich keine Antwort.'
			USING ERRCODE = 'HT007';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

-- A reading is kept as written; since #510 a reading a round wrote is marked
-- removed when the round is opened again, one level below the statement.
CREATE OR REPLACE FUNCTION "reading_kept_as_written"() RETURNS trigger
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

		IF old.recorded_by IS NOT NULL AND new.recorded_by IS NULL
		   AND (to_jsonb(new) - 'recorded_by') = (to_jsonb(old) - 'recorded_by')
		   AND nullif(current_setting('app.user_id', true), '') IS NULL
		   AND public.record_retention_ended('reading_person', old.read_on) THEN
			RETURN new;
		END IF;

		IF pg_trigger_depth() > 1
		   AND old.deleted_at IS NULL AND new.deleted_at IS NOT NULL
		   AND (to_jsonb(new) - 'deleted_at') = (to_jsonb(old) - 'deleted_at')
		   AND public.activity_reopening_of(old.activity_id) THEN
			RETURN new;
		END IF;
	END IF;

	RAISE EXCEPTION 'Ein Zählerstand wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Stand, der ihn nennt.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
GRANT UPDATE ("deleted_at") ON "meter_readings" TO "opengewerk_app";--> statement-breakpoint

-- A round is written down once per handing in: a further record only for a
-- round opened again since the one before.
CREATE FUNCTION "round_record_once_per_opening"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		  FROM public.round_records r
		  JOIN public.activities a ON a.tenant_id = r.tenant_id AND a.id = r.activity_id
		 WHERE r.tenant_id = new.tenant_id
		   AND r.activity_id = new.activity_id
		   AND (a.reopened_at IS NULL OR r.created_at > a.reopened_at)
	) THEN
		RAISE EXCEPTION 'Ein Rundgang wird je Abgabe einmal niedergeschrieben.' USING ERRCODE = 'HT017';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "round_record_once_per_opening" BEFORE INSERT ON "round_records"
	FOR EACH ROW EXECUTE FUNCTION "round_record_once_per_opening"();
