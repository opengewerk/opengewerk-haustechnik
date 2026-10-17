-- The end of the retention of an evidence and its deletion (#340, ADR 0004,
-- addendum of 17.10.2026; section 2.6 of the concept, decided on 15.10.2026:
-- an empty shell with number, duty and day stays).
--
-- - `evidence_retention_ends(evidence)`: the day the retention of an evidence
--   ends, or null while it does not. The one place the run and the deletion
--   ask. Invoker's rights: it reads what the person of the transaction sees.
-- - `evidence_retention_settings`: the longer retention of an operator.
-- - `evidence_emptyings`: the confirmation, written through the application
--   by whoever leads the operator (`session_leads()`), read and never changed. Before it is
--   written the database checks the end itself and fills in what it found;
--   after it is written a trigger empties the evidence, removes its prints,
--   blanks the reason of a voiding and closes the deadline of the end.
-- - The locks of evidence, prints and voidings let exactly that through: one
--   level below the statement, with a confirmation of the same transaction
--   (`evidence_emptying_of`), and for the evidence only into its exact shell
--   after the end. The application is granted the columns of the shell, the
--   removal of prints and the reason of a voiding, which the locks refuse on
--   every other way.
-- - The change log writes nothing at the evidence a transaction confirms
--   for deletion, at its prints and its voiding (`evidence_emptying_of`): it
--   would copy what goes. Its triggers on these tables are split for that,
--   writing a row unconditionally and its change or removal unless it is
--   that one. The confirmation itself stands in it.

CREATE TABLE "evidence_emptyings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention" jsonb,
	"minimum_years" integer,
	"ended_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_emptyings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_emptyings_minimum_years_shaped" CHECK ("evidence_emptyings"."minimum_years" is null or "evidence_emptyings"."minimum_years" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "evidence_emptyings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence_retention_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"minimum_years" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_retention_settings_once" UNIQUE("tenant_id"),
	CONSTRAINT "evidence_retention_settings_minimum_years_shaped" CHECK ("evidence_retention_settings"."minimum_years" is null or "evidence_retention_settings"."minimum_years" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "evidence_retention_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_not_performed_with_a_reason";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_report_by_an_examiner";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_performed_by_somebody";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_replacement_with_a_reason";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "written_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "emptied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_emptyings" ADD CONSTRAINT "evidence_emptyings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_emptyings" ADD CONSTRAINT "evidence_emptyings_follow_their_evidence" FOREIGN KEY ("tenant_id","evidence_id","area_id") REFERENCES "public"."evidence"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_emptyings" ADD CONSTRAINT "evidence_emptyings_of_an_evidence_of_their_property" FOREIGN KEY ("tenant_id","evidence_id","property_id") REFERENCES "public"."evidence"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence_emptyings" ADD CONSTRAINT "evidence_emptyings_by_somebody_here" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_retention_settings" ADD CONSTRAINT "evidence_retention_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_emptied_once" ON "evidence_emptyings" USING btree ("tenant_id","evidence_id");--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_evidence" FOREIGN KEY ("tenant_id","evidence_id","area_id") REFERENCES "public"."evidence"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deadlines_evidence_idx" ON "deadlines" USING btree ("tenant_id","evidence_id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_written_by_somebody" CHECK ("evidence"."emptied_at" is not null or "evidence"."written_by" is not null);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_emptied_is_empty" CHECK ("evidence"."emptied_at" is null or ("evidence"."state" = '{"version": 0}'::jsonb
        and num_nonnulls("evidence"."performed_by", "evidence"."examiner", "evidence"."examiner_organisation", "evidence"."contractor_id",
                         "evidence"."written_by", "evidence"."result_reason", "evidence"."replacement_reason") = 0));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_not_performed_with_a_reason" CHECK ("evidence"."emptied_at" is not null or ("evidence"."result" = 'not_performed') = ("evidence"."result_reason" is not null));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_report_by_an_examiner" CHECK ("evidence"."emptied_at" is not null or "evidence"."origin" <> 'report' or "evidence"."examiner" is not null);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_performed_by_somebody" CHECK ("evidence"."emptied_at" is not null or "evidence"."origin" = 'legacy' or num_nonnulls("evidence"."performed_by", "evidence"."examiner") >= 1);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_replacement_with_a_reason" CHECK ("evidence"."emptied_at" is not null or ("evidence"."replaces_evidence_id" is null) = ("evidence"."replacement_reason" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id", "deadlines"."evidence_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence_emptyings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("evidence_emptyings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("evidence_emptyings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "evidence_emptyings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "evidence_emptyings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "evidence_emptyings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = "evidence_emptyings"."evidence_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "evidence_emptyings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = "evidence_emptyings"."evidence_id")));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence_retention_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("evidence_retention_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("evidence_retention_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

CREATE FUNCTION "evidence_retention_ends"(p_evidence uuid) RETURNS date
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	WITH e AS (
		SELECT e.duty_id, e.performed_on, e.state -> 'retention' AS r
		  FROM public.evidence e
		 WHERE e.id = p_evidence AND e.emptied_at IS NULL
	), rule AS (
		SELECT e.performed_on,
		       CASE
		         WHEN e.r ->> 'kind' = 'years'
		           THEN (e.performed_on + make_interval(years => (e.r ->> 'years')::int))::date
		         WHEN e.r ->> 'kind' = 'while_in_use' AND d.asset_id IS NOT NULL
		           THEN (SELECT min(l.valid_from) FROM public.asset_lifecycle l
		                  WHERE l.asset_id = d.asset_id AND l.state = 'removed')
		         ELSE (SELECT min(n.performed_on) FROM public.evidence n
		                WHERE n.duty_id = e.duty_id AND n.performed_on > e.performed_on
		                  AND NOT EXISTS (SELECT 1 FROM public.evidence_voidings v WHERE v.evidence_id = n.id))
		       END AS day
		  FROM e
		  JOIN public.duties d ON d.id = e.duty_id
	)
	SELECT CASE
	         WHEN rule.day IS NULL THEN NULL
	         ELSE greatest(rule.day, (rule.performed_on + make_interval(years => coalesce(s.minimum_years, 0)))::date)
	       END
	  FROM rule
	  LEFT JOIN public.evidence_retention_settings s
	    ON s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE FUNCTION "session_leads"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1
		  FROM public.memberships m
		  JOIN public.tenant_roles r ON r.tenant_id = m.tenant_id AND r.key = ANY (m.roles) AND r.leads
		 WHERE m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
		   AND m.user_id = nullif(current_setting('app.user_id', true), '')
		   AND m.blocked_at IS NULL
		   AND (m.last_day IS NULL OR m.last_day >= (now() AT TIME ZONE 'Europe/Berlin')::date)
	)
$$;--> statement-breakpoint
CREATE FUNCTION "evidence_emptying_of"(p_evidence uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public.evidence_emptyings c
		 WHERE c.evidence_id = p_evidence AND c.confirmed_at = now()
	)
$$;--> statement-breakpoint

-- Before the confirmation is written: whoever writes it leads the operator
-- and names themselves, and the retention has ended. What the database found
-- is written with it, whatever the statement said.
CREATE FUNCTION "evidence_emptying_confirmed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	ends date;
BEGIN
	-- For the application, which is every way but the owner's: whoever
	-- confirms leads the operator and names themselves.
	IF current_user = 'opengewerk_app'
	   AND (new.confirmed_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')
	        OR NOT public.session_leads()) THEN
		RAISE EXCEPTION 'Löschen bestätigt nur, wer den Betreiber führt.' USING ERRCODE = 'HT008';
	END IF;

	IF EXISTS (SELECT 1 FROM public.evidence e WHERE e.id = new.evidence_id AND e.emptied_at IS NOT NULL) THEN
		RAISE EXCEPTION 'Dieser Nachweis ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	ends := public.evidence_retention_ends(new.evidence_id);

	IF ends IS NULL OR ends > (now() AT TIME ZONE 'Europe/Berlin')::date THEN
		RAISE EXCEPTION 'Die Aufbewahrung dieses Nachweises ist nicht abgelaufen.' USING ERRCODE = 'HT008';
	END IF;

	SELECT nullif(e.state -> 'retention', 'null'::jsonb), e.property_id, e.area_id
	  INTO new.retention, new.property_id, new.area_id
	  FROM public.evidence e
	 WHERE e.id = new.evidence_id;
	new.minimum_years := (SELECT s.minimum_years FROM public.evidence_retention_settings s
	                       WHERE s.tenant_id = new.tenant_id);
	new.ended_on := ends;
	new.confirmed_at := now();

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "evidence_emptying_confirmed" BEFORE INSERT ON "evidence_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "evidence_emptying_confirmed"();--> statement-breakpoint

-- After it is written: the evidence becomes its shell, its prints go, the
-- reason of a voiding becomes a fixed sentence (the voiding itself stays: the
-- shell would count for the deadline again without it), and the deadline of
-- the end is done.
CREATE FUNCTION "evidence_emptying_empties"() RETURNS trigger
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
	UPDATE public.evidence_voidings SET reason = 'Gelöscht nach Ablauf der Aufbewahrung.' WHERE evidence_id = new.evidence_id;
	UPDATE public.deadlines
	   SET status = 'done', closed_at = now(), closed_by = new.confirmed_by
	 WHERE evidence_id = new.evidence_id AND status = 'open';

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "evidence_emptying_empties" AFTER INSERT ON "evidence_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "evidence_emptying_empties"();--> statement-breakpoint

-- A confirmation is kept as written; its area alone follows the property.
CREATE FUNCTION "emptying_kept_as_written"() RETURNS trigger
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

	RAISE EXCEPTION 'Die Bestätigung, dass ein Nachweis gelöscht wird, wird nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT009';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "emptying_kept_as_written" BEFORE UPDATE OR DELETE ON "evidence_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "emptying_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "emptying_kept_whole" BEFORE TRUNCATE ON "evidence_emptyings"
	FOR EACH STATEMENT EXECUTE FUNCTION "emptying_kept_as_written"();--> statement-breakpoint

-- The lock of the evidence (0010) with the one exception of ADR 0004, point 18.
CREATE OR REPLACE FUNCTION "evidence_stays_as_written"() RETURNS trigger
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

		-- Into its empty shell after the end of the retention (#340): one level
		-- below the statement, confirmed in this transaction, and exactly the shell.
		IF pg_trigger_depth() > 1
		   AND old.emptied_at IS NULL
		   AND new.emptied_at IS NOT NULL
		   AND public.evidence_emptying_of(old.id)
		   AND public.evidence_retention_ends(old.id) <= (now() AT TIME ZONE 'Europe/Berlin')::date
		   AND to_jsonb(new) = to_jsonb(old) || jsonb_build_object(
		         'state', '{"version": 0}'::jsonb,
		         'fingerprint', encode(sha256(convert_to('{"version":0}', 'UTF8')), 'hex'),
		         'emptied_at', to_jsonb(new.emptied_at),
		         'performed_by', NULL,
		         'examiner', NULL,
		         'examiner_organisation', NULL,
		         'contractor_id', NULL,
		         'written_by', NULL,
		         'result_reason', NULL,
		         'replacement_reason', NULL) THEN
			RETURN new;
		END IF;
	END IF;

	RAISE EXCEPTION 'Ein Nachweis wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Nachweis, der ihn nennt.'
		USING ERRCODE = 'HT003';
END;
$$;--> statement-breakpoint

-- The lock of a voiding (0012): its reason becomes the fixed sentence when its
-- evidence is emptied.
CREATE OR REPLACE FUNCTION "voiding_kept_as_written"() RETURNS trigger
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

		IF pg_trigger_depth() > 1
		   AND public.evidence_emptying_of(old.evidence_id)
		   AND to_jsonb(new) = to_jsonb(old) || jsonb_build_object('reason', 'Gelöscht nach Ablauf der Aufbewahrung.') THEN
			RETURN new;
		END IF;
	END IF;

	RAISE EXCEPTION 'Eine Ungültigerklärung wird nicht geändert und nicht gelöscht. Der Nachweis bleibt mit ihr lesbar.'
		USING ERRCODE = 'HT006';
END;
$$;--> statement-breakpoint

-- The lock of a frozen state and its PDF (0034): the print of an evidence goes
-- when its evidence is emptied.
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

-- The change log, without what goes.
DROP TRIGGER "audit_changes" ON "evidence";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "evidence"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "evidence"
	FOR EACH ROW WHEN (NOT public.evidence_emptying_of(old.id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "evidence_voidings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "evidence_voidings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "evidence_voidings"
	FOR EACH ROW WHEN (NOT public.evidence_emptying_of(old.evidence_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "prints";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "prints"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "prints"
	FOR EACH ROW WHEN (NOT public.evidence_emptying_of(old.evidence_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "evidence_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "evidence_retention_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

ALTER TABLE "evidence_emptyings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence_retention_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "evidence_emptyings" TO "opengewerk_app";--> statement-breakpoint
GRANT INSERT ("tenant_id", "property_id", "area_id", "evidence_id", "confirmed_by") ON "evidence_emptyings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "evidence_retention_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("state", "fingerprint", "emptied_at", "performed_by", "examiner", "examiner_organisation", "contractor_id", "written_by", "result_reason", "replacement_reason") ON "evidence" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("reason") ON "evidence_voidings" TO "opengewerk_app";--> statement-breakpoint
GRANT DELETE ON "prints" TO "opengewerk_app";
