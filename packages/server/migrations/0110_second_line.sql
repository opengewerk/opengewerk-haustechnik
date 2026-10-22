-- The second line of the database where the first one was the server alone
-- (#534, with #535, #539 and #542 from the comparison of Phase 2).
--
-- 1. A role of an operator's own never leads and never holds a right that
--    stays with the Leitung (`leadingRights` in packages/domain): the routes
--    held it, and `session_leads()` trusts it when evidence is emptied and a
--    value in the log is blacked out. `tenant_role_leads_alone` holds it for
--    the application role: a second row that leads is not added, and a row
--    that does not lead holds none of the seven rights. A migration, as the
--    owner, gives a shipped role what it is owed, as before.
-- 2. After the last day of an access the database kept the person out of the
--    tables with an area only, by `session_areas()`. `session_works_here()`
--    asks the same of the membership for the tables without an area, as the
--    restrictive policy `within_access`: the stores, the contractors and
--    their contracts, the qualifications and the delegations, and the rows of
--    contacts, documents and deadlines that hang on a contractor. A
--    transaction without a person, a background run or a report without an
--    account, is not asked: it works for nobody. The policy stands here and
--    not in the schema, like a trigger: the factories of the foundation that
--    make some of these tables take no policy of an application, and a test
--    holds the list against `pg_policy`.
-- 3. The deadline run says that it is the run, `app.deadline_run`, set by
--    `asTheDeadlineRun` and by nothing else, and the four functions that let
--    it remove what has passed its retention ask that instead of whether a
--    person is missing. Their bodies are those of 0101 and 0103 otherwise.
--
-- #535 needs no statement: the application keeps UPDATE on ten columns of
-- `evidence` because the trigger that empties one runs with its rights, and
-- `evidence_stays_as_written` lets through that and nothing else (ADR 0004,
-- addendum of 22.10.2026).
CREATE FUNCTION "tenant_role_leads_alone"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF current_user <> 'opengewerk_app' THEN
		RETURN new;
	END IF;

	IF tg_op = 'INSERT' AND new.leads
	   AND EXISTS (SELECT 1 FROM public.tenant_roles r WHERE r.tenant_id = new.tenant_id AND r.leads) THEN
		RAISE EXCEPTION 'Eine eigene Rolle führt den Betreiber nicht und hält kein Recht, das der Leitung bleibt.'
			USING ERRCODE = 'HT019';
	END IF;

	IF NOT new.leads AND new.rights && ARRAY['duty.delegate', 'membership.read', 'membership.write', 'mail.read', 'mail.write', 'privacy.generate', 'audit.read']::text[] THEN
		RAISE EXCEPTION 'Eine eigene Rolle führt den Betreiber nicht und hält kein Recht, das der Leitung bleibt.'
			USING ERRCODE = 'HT019';
	END IF;

	RETURN new;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tenant_roles_lead_alone" BEFORE INSERT OR UPDATE ON "tenant_roles"
	FOR EACH ROW EXECUTE FUNCTION "tenant_role_leads_alone"();
--> statement-breakpoint
CREATE FUNCTION "session_works_here"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT nullif(current_setting('app.user_id', true), '') IS NULL
	    OR EXISTS (
		SELECT 1
		  FROM public.memberships m
		 WHERE m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
		   AND m.user_id = nullif(current_setting('app.user_id', true), '')
		   AND m.blocked_at IS NULL
		   AND (m.last_day IS NULL OR m.last_day >= (now() AT TIME ZONE 'Europe/Berlin')::date)
	)
$$;
--> statement-breakpoint
CREATE POLICY "within_access" ON "suppliers" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "articles" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "stores" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "store_articles" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "stock_movements" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "store_labels" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "contractors" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "contracts" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "qualification_kinds" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "qualifications" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "duty_delegations" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "duty_delegation_areas" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "duty_delegation_signatures" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "duty_delegation_revocations" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING ((SELECT session_works_here())) WITH CHECK ((SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "contacts" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING (("area_id" IS NOT NULL) OR (SELECT session_works_here()))
	WITH CHECK (("area_id" IS NOT NULL) OR (SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "attachments" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING (("area_id" IS NOT NULL) OR (SELECT session_works_here()))
	WITH CHECK (("area_id" IS NOT NULL) OR (SELECT session_works_here()));
--> statement-breakpoint
CREATE POLICY "within_access" ON "deadlines" AS RESTRICTIVE FOR ALL TO "opengewerk_app"
	USING (("area_id" IS NOT NULL) OR (SELECT session_works_here()))
	WITH CHECK (("area_id" IS NOT NULL) OR (SELECT session_works_here()));
--> statement-breakpoint
CREATE FUNCTION "session_is_the_deadline_run"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT nullif(current_setting('app.user_id', true), '') IS NULL
	   AND current_setting('app.deadline_run', true) = 'on'
$$;
--> statement-breakpoint
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
		   AND public.session_is_the_deadline_run()
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
		   AND public.session_is_the_deadline_run()
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
	   AND public.session_is_the_deadline_run()
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
		   AND public.session_is_the_deadline_run()
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
