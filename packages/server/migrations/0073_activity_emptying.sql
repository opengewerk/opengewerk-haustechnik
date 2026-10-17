-- The activity behind an evidence deleted after the end of its retention
-- (#409, section 2.6 of the concept, ADR 0004, addendum of 17.10.2026): when
-- the last evidence of an activity becomes its shell (#340), the activity
-- becomes a shell as well, in the same trigger.
--
-- - `activity_emptying_of(activity)`: an evidence of the activity is
--   confirmed for deletion in this transaction, and none of its evidence is
--   left that is not emptied. What the locks and the change log ask.
-- - The shell: the activity keeps its kind, place, day and status, its duties
--   with their result, a work order its number, kind and measure; title and
--   reasons become a fixed sentence, the people and the free texts go. A defect found in it
--   keeps its own content and loses the answer it was found at.
-- - What goes: its answers, signatures, the participants, notes, materials
--   and decision of a work order, service reports with their records, the
--   briefings and permits, the record of a round and the PDFs of the
--   activity. Its documents are removed the way a person removes one; their
--   versions and files are the foundation's (opengewerk/opengewerk#657).
-- - The emptying sees every area: the evidence of a round can lie in areas
--   the person who confirms does not see, and so can the activity.
-- - The application is granted DELETE on these tables. Every lock refuses a
--   deletion on every other way: one level below the statement and for an
--   activity this transaction empties, or not at all. An activity emptied
--   takes nothing new and is not changed any more.
-- - The change log writes the rows and does not copy what goes: its
--   triggers on these tables are split as at the evidence (0071).

ALTER TABLE "activities" ADD COLUMN "emptied_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "evidence_activity_idx" ON "evidence" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "activities_emptied_idx" ON "activities" USING btree ("tenant_id","emptied_at") WHERE "activities"."emptied_at" is not null;--> statement-breakpoint

CREATE FUNCTION "activity_emptying_of"(p_activity uuid) RETURNS boolean
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
CREATE FUNCTION "activity_of_work_order"(p_work_order uuid) RETURNS uuid
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT w.activity_id FROM public.work_orders w WHERE w.id = p_work_order
$$;--> statement-breakpoint
CREATE FUNCTION "activity_of_service_report"(p_service_report uuid) RETURNS uuid
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT r.activity_id FROM public.service_reports r WHERE r.id = p_service_report
$$;--> statement-breakpoint
-- The activity a row of one of the tables below hangs on: by its own column,
-- through its work order or through its service report.
CREATE FUNCTION "activity_of_row"(p_row jsonb) RETURNS uuid
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(
		(p_row ->> 'activity_id')::uuid,
		public.activity_of_work_order((p_row ->> 'work_order_id')::uuid),
		public.activity_of_service_report((p_row ->> 'service_report_id')::uuid))
$$;--> statement-breakpoint

-- The emptying of #340, and after it the activity when that was its last evidence.
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

-- An activity becomes its shell only with its last evidence, exactly so, and
-- stays one; its area alone still follows its property.
CREATE FUNCTION "activity_kept_once_emptied"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	stamped text[] := ARRAY['updated_at', 'updated_by', 'version', 'change_sequence'];
BEGIN
	IF old.emptied_at IS NOT NULL THEN
		IF pg_trigger_depth() > 1
		   AND old.area_id IS DISTINCT FROM new.area_id
		   AND (to_jsonb(new) - 'area_id' - stamped) = (to_jsonb(old) - 'area_id' - stamped) THEN
			RETURN new;
		END IF;

		RAISE EXCEPTION 'Ein gelöschter Vorgang wird nicht geändert.' USING ERRCODE = 'HT010';
	END IF;

	IF new.emptied_at IS NOT NULL THEN
		IF pg_trigger_depth() > 1
		   AND public.activity_emptying_of(old.id)
		   AND (to_jsonb(new) - stamped) = ((to_jsonb(old) || jsonb_build_object(
		         'emptied_at', to_jsonb(new.emptied_at),
		         'title', 'Gelöscht nach Ablauf der Aufbewahrung',
		         'closing_reason', CASE WHEN old.closing_reason IS NULL THEN NULL ELSE 'Gelöscht nach Ablauf der Aufbewahrung.' END,
		         'responsible_user_id', NULL,
		         'performer_user_id', NULL,
		         'contractor_note', NULL,
		         'contractor_id', NULL,
		         'device_id', NULL)) - stamped) THEN
			RETURN new;
		END IF;

		RAISE EXCEPTION 'Ein Vorgang wird nur mit seinem letzten Nachweis nach Ablauf der Aufbewahrung gelöscht.'
			USING ERRCODE = 'HT010';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_kept_once_emptied" BEFORE UPDATE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "activity_kept_once_emptied"();--> statement-breakpoint

-- What an emptied activity holds is not added to.
CREATE FUNCTION "refuses_an_emptied_activity"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM public.activities a
		 WHERE a.id = public.activity_of_row(to_jsonb(new)) AND a.emptied_at IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Ein gelöschter Vorgang nimmt nichts mehr auf.' USING ERRCODE = 'HT010';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "activity_duties"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "activity_signatures"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "work_order_decisions"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "work_order_participants"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "work_order_notes"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "work_order_materials"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "service_reports"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "work_permits"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "round_records"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "prints"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
CREATE TRIGGER "refuses_an_emptied_activity" BEFORE INSERT ON "attachments"
	FOR EACH ROW EXECUTE FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint

-- The locks (0011, 0026, 0031, 0053, 0055, 0061, 0071) with the one way out:
-- one level below the statement, for an activity this transaction empties.
CREATE OR REPLACE FUNCTION "kept_as_written"() RETURNS trigger
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

	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.activity_emptying_of(public.activity_of_row(to_jsonb(old))) THEN
		RETURN old;
	END IF;

	IF tg_table_name = 'activity_signatures' THEN
		RAISE EXCEPTION 'Eine Unterschrift wird nicht geändert und nicht gelöscht. Wird ein Auftrag zurückgewiesen, bleibt sie stehen und gilt nicht mehr.'
			USING ERRCODE = 'HT005';
	END IF;

	RAISE EXCEPTION 'Eine Abnahme oder Zurückweisung wird nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
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
CREATE OR REPLACE FUNCTION "note_kept_as_written"() RETURNS trigger
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

	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.activity_emptying_of(old.activity_id) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Notiz wird nicht geändert und nicht gelöscht. Was nicht stimmt, sagt eine weitere Notiz.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "service_report_kept_as_written"() RETURNS trigger
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

	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.activity_emptying_of(old.activity_id) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Ein Leistungsnachweis wird nicht geändert und nicht gelöscht. Wird der Auftrag zurückgewiesen, bleibt er stehen und gilt nicht mehr.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "material_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'UPDATE' THEN
		IF pg_trigger_depth() > 1
		   AND (old.area_id IS DISTINCT FROM new.area_id OR old.property_id IS DISTINCT FROM new.property_id)
		   AND (to_jsonb(new) - 'area_id' - 'property_id') = (to_jsonb(old) - 'area_id' - 'property_id') THEN
			RETURN new;
		END IF;
	END IF;

	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.activity_emptying_of(old.activity_id) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Eine Entnahme am Auftrag wird nicht geändert und nicht gelöscht. Was nicht stimmt, berichtigt eine Zählung im Lager.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visit_kept_as_written"() RETURNS trigger
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

	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.activity_emptying_of(old.activity_id) THEN
		RETURN old;
	END IF;

	IF tg_table_name = 'briefings' THEN
		RAISE EXCEPTION 'Eine Einweisung wird nicht geändert und nicht gelöscht. Sie bleibt, wie die eingewiesene Person sie unterschrieben hat.'
			USING ERRCODE = 'HT005';
	END IF;

	RAISE EXCEPTION 'Ein Erlaubnisschein wird nicht geändert und nicht gelöscht. Er bleibt, wie er erteilt wurde.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "print_kept_as_written"() RETURNS trigger
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

	IF tg_op = 'DELETE'
	   AND tg_table_name = 'prints'
	   AND pg_trigger_depth() > 1
	   AND (to_jsonb(old) ->> 'evidence_id') IS NOT NULL
	   AND public.evidence_emptying_of((to_jsonb(old) ->> 'evidence_id')::uuid) THEN
		RETURN old;
	END IF;

	-- The PDFs and records of an activity, with the activity (#409).
	IF tg_op = 'DELETE'
	   AND pg_trigger_depth() > 1
	   AND public.activity_emptying_of(public.activity_of_row(to_jsonb(old))) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Ein eingefrorener Stand und sein PDF werden nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint

-- The participants of a work order have no lock of their own: removing one
-- marks it. Deleted it is only with its activity.
CREATE FUNCTION "removed_only_with_its_activity"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF pg_trigger_depth() > 1 AND public.activity_emptying_of(public.activity_of_row(to_jsonb(old))) THEN
		RETURN old;
	END IF;

	RAISE EXCEPTION 'Gelöscht wird hier nur mit dem Vorgang nach Ablauf der Aufbewahrung.' USING ERRCODE = 'HT010';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "removed_only_with_its_activity" BEFORE DELETE ON "work_order_participants"
	FOR EACH ROW EXECUTE FUNCTION "removed_only_with_its_activity"();--> statement-breakpoint

-- The change log, without what goes.
DROP TRIGGER "audit_changes" ON "activities";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "activities"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activity_duties";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "activity_duties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "activity_duties"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_orders";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "work_orders"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_orders"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activity_answers";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "activity_answers"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activity_signatures";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "activity_signatures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "activity_signatures"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_decisions";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "work_order_decisions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_order_decisions"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(public.activity_of_work_order(old.work_order_id))) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_participants";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "work_order_participants"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_order_participants"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_notes";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "work_order_notes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_order_notes"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_materials";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "work_order_materials"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_order_materials"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "service_reports";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "service_reports"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "service_reports"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "service_report_records";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "service_report_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "service_report_records"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(public.activity_of_service_report(old.service_report_id))) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "briefings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "briefings"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_permits";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "work_permits"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_permits"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "round_records";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "round_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "round_records"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "prints";--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "prints"
	FOR EACH ROW WHEN (NOT (public.evidence_emptying_of(old.evidence_id)
	                        OR public.activity_emptying_of(coalesce(old.activity_id, public.activity_of_service_report(old.service_report_id)))))
	EXECUTE FUNCTION "record_change"();--> statement-breakpoint

GRANT DELETE ON "activity_answers", "activity_signatures", "work_order_decisions", "work_order_participants",
	"work_order_notes", "work_order_materials", "service_reports", "service_report_records", "briefings",
	"work_permits", "round_records" TO "opengewerk_app";
