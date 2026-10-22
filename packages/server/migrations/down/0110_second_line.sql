-- Takes back 0110_second_line: the functions as 0101 and 0103 left them, no policy
-- `within_access`, no trigger on the roles.
CREATE OR REPLACE FUNCTION "task_goes_after_retention"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'DELETE' THEN
		IF current_user <> 'opengewerk_app' THEN
			UPDATE public.deadlines SET task_id = NULL WHERE tenant_id = old.tenant_id AND task_id = old.id;

			RETURN old;
		END IF;

		IF old.status = 'done'
		   AND nullif(current_setting('app.user_id', true), '') IS NULL
		   AND public.record_retention_ended('task', coalesce(old.done_on, (old.updated_at AT TIME ZONE 'Europe/Berlin')::date)) THEN
			UPDATE public.deadlines SET task_id = NULL WHERE tenant_id = old.tenant_id AND task_id = old.id;

			RETURN old;
		END IF;
	END IF;

	RAISE EXCEPTION 'Eine Aufgabe wird als entfernt markiert und nicht gelöscht. Ein Jahr nach ihrer Erledigung löscht sie der Fristenlauf.'
		USING ERRCODE = 'HT009';
END;
$$;
--> statement-breakpoint
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
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "booking_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF tg_op = 'UPDATE'
	   AND old.booked_by IS NOT NULL AND new.booked_by IS NULL
	   AND (to_jsonb(new) - 'booked_by') = (to_jsonb(old) - 'booked_by')
	   AND nullif(current_setting('app.user_id', true), '') IS NULL
	   AND public.record_retention_ended('booking_person', (old.booked_at AT TIME ZONE 'Europe/Berlin')::date) THEN
		RETURN new;
	END IF;

	RAISE EXCEPTION 'Eine Buchung im Lager wird nicht geändert und nicht gelöscht. Was nicht stimmt, berichtigt eine Zählung.'
		USING ERRCODE = 'HT005';
END;
$$;
--> statement-breakpoint
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

		IF old.taken_by IS NOT NULL AND new.taken_by IS NULL
		   AND (to_jsonb(new) - 'taken_by') = (to_jsonb(old) - 'taken_by')
		   AND nullif(current_setting('app.user_id', true), '') IS NULL
		   AND public.record_retention_ended('booking_person', (old.taken_at AT TIME ZONE 'Europe/Berlin')::date) THEN
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
$$;
--> statement-breakpoint
DROP FUNCTION "session_is_the_deadline_run"();
--> statement-breakpoint
DROP POLICY "within_access" ON "suppliers";
--> statement-breakpoint
DROP POLICY "within_access" ON "articles";
--> statement-breakpoint
DROP POLICY "within_access" ON "stores";
--> statement-breakpoint
DROP POLICY "within_access" ON "store_articles";
--> statement-breakpoint
DROP POLICY "within_access" ON "stock_movements";
--> statement-breakpoint
DROP POLICY "within_access" ON "store_labels";
--> statement-breakpoint
DROP POLICY "within_access" ON "contractors";
--> statement-breakpoint
DROP POLICY "within_access" ON "contracts";
--> statement-breakpoint
DROP POLICY "within_access" ON "qualification_kinds";
--> statement-breakpoint
DROP POLICY "within_access" ON "qualifications";
--> statement-breakpoint
DROP POLICY "within_access" ON "duty_delegations";
--> statement-breakpoint
DROP POLICY "within_access" ON "duty_delegation_areas";
--> statement-breakpoint
DROP POLICY "within_access" ON "duty_delegation_signatures";
--> statement-breakpoint
DROP POLICY "within_access" ON "duty_delegation_revocations";
--> statement-breakpoint
DROP POLICY "within_access" ON "contacts";
--> statement-breakpoint
DROP POLICY "within_access" ON "attachments";
--> statement-breakpoint
DROP POLICY "within_access" ON "deadlines";
--> statement-breakpoint
DROP FUNCTION "session_works_here"();
--> statement-breakpoint
DROP TRIGGER "tenant_roles_lead_alone" ON "tenant_roles";
--> statement-breakpoint
DROP FUNCTION "tenant_role_leads_alone"();
