-- Takes back 0103_round_reopening: the locks as they were, the triggers, the
-- grant and the column. A round opened again cannot be closed again; while
-- one was, this does not run.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "activities" WHERE "reopened_at" IS NOT NULL) THEN
		RAISE EXCEPTION 'Ein Rundgang ist schon wieder geöffnet worden; 0103 lässt sich nicht zurücknehmen.';
	END IF;
END;
$$;--> statement-breakpoint
DROP TRIGGER "round_record_once_per_opening" ON "round_records";--> statement-breakpoint
DROP FUNCTION "round_record_once_per_opening"();--> statement-breakpoint
REVOKE UPDATE ("deleted_at") ON "meter_readings" FROM "opengewerk_app";--> statement-breakpoint
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
	END IF;

	RAISE EXCEPTION 'Ein Zählerstand wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Stand, der ihn nennt.'
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
DROP TRIGGER "activity_reopening_removes" ON "activities";--> statement-breakpoint
DROP FUNCTION "activity_reopening_removes"();--> statement-breakpoint
DROP TRIGGER "activity_reopened" ON "activities";--> statement-breakpoint
DROP FUNCTION "activity_reopened"();--> statement-breakpoint
DROP FUNCTION "activity_reopening_of"(uuid);--> statement-breakpoint
DROP INDEX "round_records_activity_idx";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "reopened_at";--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_once" UNIQUE("tenant_id","activity_id");
