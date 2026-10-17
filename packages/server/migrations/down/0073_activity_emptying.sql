-- Takes back 0073_activity_emptying: the emptying of #340 and the locks as
-- they were, the change log in one trigger again, the grants, the functions,
-- the column and the indexes. What an emptied activity held cannot come
-- back; while there is one, this does not run.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "activities" WHERE "emptied_at" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt gelöschte Vorgänge; 0073 lässt sich nicht zurücknehmen.';
	END IF;
END;
$$;--> statement-breakpoint
REVOKE DELETE ON "activity_answers", "activity_signatures", "work_order_decisions", "work_order_participants",
	"work_order_notes", "work_order_materials", "service_reports", "service_report_records", "briefings",
	"work_permits", "round_records" FROM "opengewerk_app";--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "activities";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activities";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "activity_duties";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activity_duties";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_duties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_orders";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_orders";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_orders"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "activity_answers";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activity_answers";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "activity_signatures";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "activity_signatures";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_signatures"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_order_decisions";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_decisions";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_decisions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_order_participants";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_participants";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_participants"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_order_notes";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_notes";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_notes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_order_materials";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_order_materials";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_order_materials"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "service_reports";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "service_reports";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "service_reports"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "service_report_records";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "service_report_records";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "service_report_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "briefings";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "briefings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_permits";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "work_permits";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "work_permits"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "round_records";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "round_records";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "round_records"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "prints";--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "prints"
	FOR EACH ROW WHEN (NOT public.evidence_emptying_of(old.evidence_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "removed_only_with_its_activity" ON "work_order_participants";--> statement-breakpoint
DROP FUNCTION "removed_only_with_its_activity"();--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "activity_duties";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "activity_answers";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "activity_signatures";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "work_order_decisions";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "work_order_participants";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "work_order_notes";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "work_order_materials";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "service_reports";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "briefings";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "work_permits";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "round_records";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "prints";--> statement-breakpoint
DROP TRIGGER "refuses_an_emptied_activity" ON "attachments";--> statement-breakpoint
DROP FUNCTION "refuses_an_emptied_activity"();--> statement-breakpoint
DROP TRIGGER "activity_kept_once_emptied" ON "activities";--> statement-breakpoint
DROP FUNCTION "activity_kept_once_emptied"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "evidence_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
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
	 WHERE id = new.evidence_id AND emptied_at IS NULL;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Dieser Nachweis ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	DELETE FROM public.prints WHERE evidence_id = new.evidence_id;
	DELETE FROM public.evidence_signed_prints WHERE evidence_id = new.evidence_id;
	UPDATE public.evidence_voidings SET reason = 'Gelöscht nach Ablauf der Aufbewahrung.' WHERE evidence_id = new.evidence_id;
	UPDATE public.deadlines
	   SET status = 'done', closed_at = now(), closed_by = new.confirmed_by
	 WHERE evidence_id = new.evidence_id AND status = 'open';

	RETURN NULL;
END;
$$;--> statement-breakpoint
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

	IF tg_op = 'DELETE' THEN
		tenant := old.tenant_id;
		activity := old.activity_id;
	ELSE
		tenant := new.tenant_id;
		activity := new.activity_id;
	END IF;

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

	IF tg_op = 'DELETE' THEN
		RETURN old;
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

	RAISE EXCEPTION 'Ein eingefrorener Stand und sein PDF werden nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
DROP FUNCTION "activity_of_row"(jsonb);--> statement-breakpoint
DROP FUNCTION "activity_of_service_report"(uuid);--> statement-breakpoint
DROP FUNCTION "activity_of_work_order"(uuid);--> statement-breakpoint
DROP FUNCTION "activity_emptying_of"(uuid);--> statement-breakpoint
DROP INDEX "activities_emptied_idx";--> statement-breakpoint
DROP INDEX "evidence_activity_idx";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "emptied_at";
