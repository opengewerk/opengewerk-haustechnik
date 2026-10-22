-- The collective activity in the database (#551, with #550): what the
-- server and the sync held alone.
--
-- 1. The answers of a part are locked by the one signature of its collective
--    activity as by one of its own: `answers_kept_once_signed` asks the
--    signatures of the activity and of the collective it is a part of,
--    counted from the last opening of whichever was signed. Otherwise as
--    0103 left it.
-- 2. A collective activity carries no duty of its own; each part carries
--    the duty of its asset (#342). `activity_duty_not_at_a_collective` refuses
--    a line that names a collective activity, for every role.
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
		   AND (s.activity_id = activity
		        OR s.activity_id = (SELECT a.collective_id FROM public.activities a
		                             WHERE a.tenant_id = tenant AND a.id = activity))
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
CREATE FUNCTION "activity_duty_not_at_a_collective"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM public.activities a
	            WHERE a.tenant_id = new.tenant_id AND a.id = new.activity_id
	              AND a.collective_kind IS NOT NULL) THEN
		RAISE EXCEPTION 'Ein Sammelvorgang trägt keine eigene Pflicht; jede Anlage darin trägt ihre.'
			USING ERRCODE = 'HT020';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_duties_not_at_a_collective" BEFORE INSERT OR UPDATE OF "activity_id" ON "activity_duties"
	FOR EACH ROW EXECUTE FUNCTION "activity_duty_not_at_a_collective"();
