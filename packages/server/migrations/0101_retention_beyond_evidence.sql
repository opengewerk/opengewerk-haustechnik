-- What hangs on no evidence and its own retention (#412, section 2.6 of the
-- concept, decided on 21.10.2026; ADR 0004, addendum of 21.10.2026).
--
-- - An activity without evidence, done or closed as not performed, stays six
--   years from the end of the year it ended and then becomes the shell of
--   #409; a collective activity counts with its parts as one. A remedied
--   defect stays five years from the day it was remedied and then loses its
--   description, the note of its check, the answer it was found at and its
--   photos, and keeps its row. Both are proposed and confirmed by whoever
--   leads the operator (`activity_emptyings`, `defect_emptyings`), as an
--   evidence is (0071); the database checks the end itself.
-- - A task done goes a year after it was done, the person at a meter reading,
--   a booking and a material at a work order three years after it. These go
--   on the pass of the deadlines, which works for nobody; the locks let
--   exactly that through and refuse it on every other way and before the
--   end. The pass writes how many went (`retention_removals`).
-- - The days the ends count from are the database's to write, from the
--   status (`ended_on`, `remedied_on`, `done_on`). Rows from before have none
--   and count from their last change, which is never earlier.
-- - An operator lengthens each kind (`record_retention_settings`), never
--   shortens it; `record_retention_ends` is the one place every end is
--   counted.
-- - The change log does not copy what goes, as in 0071 and 0073.
-- - The key of the deadlines to the activity is checked against every row,
--   so both tables leave FORCE for the statement, as 0051 did.
--
-- **Fits the version before it.** It writes none of the new columns and
-- tables, and the person columns it leaves filled.

CREATE TABLE "activity_emptyings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"years" integer NOT NULL,
	"ended_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_emptyings_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "activity_emptyings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "defect_emptyings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"defect_id" uuid NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"years" integer NOT NULL,
	"ended_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "defect_emptyings_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "defect_emptyings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "record_retention_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity_years" integer,
	"defect_years" integer,
	"task_years" integer,
	"reading_person_years" integer,
	"booking_person_years" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_retention_settings_once" UNIQUE("tenant_id"),
	CONSTRAINT "record_retention_settings_activity_years_shaped" CHECK ("record_retention_settings"."activity_years" is null or "record_retention_settings"."activity_years" between 6 and 50),
	CONSTRAINT "record_retention_settings_defect_years_shaped" CHECK ("record_retention_settings"."defect_years" is null or "record_retention_settings"."defect_years" between 5 and 50),
	CONSTRAINT "record_retention_settings_task_years_shaped" CHECK ("record_retention_settings"."task_years" is null or "record_retention_settings"."task_years" between 1 and 50),
	CONSTRAINT "record_retention_settings_reading_person_years_shaped" CHECK ("record_retention_settings"."reading_person_years" is null or "record_retention_settings"."reading_person_years" between 3 and 50),
	CONSTRAINT "record_retention_settings_booking_person_years_shaped" CHECK ("record_retention_settings"."booking_person_years" is null or "record_retention_settings"."booking_person_years" between 3 and 50)
);
--> statement-breakpoint
ALTER TABLE "record_retention_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retention_removals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"removed_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_removals_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "retention_removals_kind_known" CHECK ("kind" in ('activity', 'defect', 'task', 'reading_person', 'booking_person')),
	CONSTRAINT "retention_removals_count_shaped" CHECK ("retention_removals"."removed_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "retention_removals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "meter_readings" ALTER COLUMN "recorded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "booked_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_materials" ALTER COLUMN "taken_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "ended_on" date;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "remedied_on" date;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "emptied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "done_on" date;--> statement-breakpoint
ALTER TABLE "activity_emptyings" ADD CONSTRAINT "activity_emptyings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_emptyings" ADD CONSTRAINT "activity_emptyings_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_emptyings" ADD CONSTRAINT "activity_emptyings_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_emptyings" ADD CONSTRAINT "activity_emptyings_by_somebody_here" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_emptyings" ADD CONSTRAINT "defect_emptyings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_emptyings" ADD CONSTRAINT "defect_emptyings_follow_their_defect" FOREIGN KEY ("tenant_id","defect_id","area_id") REFERENCES "public"."defects"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defect_emptyings" ADD CONSTRAINT "defect_emptyings_of_a_defect_of_their_property" FOREIGN KEY ("tenant_id","defect_id","property_id") REFERENCES "public"."defects"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "defect_emptyings" ADD CONSTRAINT "defect_emptyings_by_somebody_here" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_retention_settings" ADD CONSTRAINT "record_retention_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_removals" ADD CONSTRAINT "retention_removals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_emptied_once" ON "activity_emptyings" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "defect_emptied_once" ON "defect_emptyings" USING btree ("tenant_id","defect_id");--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_activity" FOREIGN KEY ("tenant_id","activity_id","area_id") REFERENCES "public"."activities"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deadlines_activity_idx" ON "deadlines" USING btree ("tenant_id","activity_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id", "deadlines"."evidence_id", "deadlines"."activity_id", "deadlines"."member_user_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activity_emptyings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("activity_emptyings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("activity_emptyings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "activity_emptyings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "activity_emptyings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "activity_emptyings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = "activity_emptyings"."activity_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "activity_emptyings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = "activity_emptyings"."activity_id")));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "defect_emptyings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("defect_emptyings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("defect_emptyings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "defect_emptyings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "within_limits" ON "defect_emptyings" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (((SELECT session_limit_properties()) IS NULL OR "defect_emptyings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.defects d WHERE d.id = "defect_emptyings"."defect_id"))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "defect_emptyings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.defects d WHERE d.id = "defect_emptyings"."defect_id")));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_retention_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("record_retention_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("record_retention_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "retention_removals" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("retention_removals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("retention_removals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- The days the database writes, from the status: the day an activity ended,
-- the day a defect was remedied, the day a task was done. A row whose status
-- does not change keeps its day, and whatever the application says is
-- ignored; only the owner of the tables may write a day of its own, for a
-- row it brings from before. Rows from before have none; the ends below
-- count them from their last change, which is never earlier.
CREATE FUNCTION "activity_ended_on"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF current_user <> 'opengewerk_app' AND new.status IN ('done', 'not_performed')
	   AND new.ended_on IS DISTINCT FROM (CASE WHEN tg_op = 'UPDATE' THEN old.ended_on END) THEN
		RETURN new;
	END IF;

	IF new.status NOT IN ('done', 'not_performed') THEN
		new.ended_on := NULL;
	ELSIF tg_op = 'UPDATE' AND old.status IN ('done', 'not_performed') THEN
		new.ended_on := old.ended_on;
	ELSE
		new.ended_on := (now() AT TIME ZONE 'Europe/Berlin')::date;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_ended_on" BEFORE INSERT OR UPDATE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "activity_ended_on"();--> statement-breakpoint
CREATE FUNCTION "defect_remedied_on"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF current_user <> 'opengewerk_app' AND new.status IN ('remedied', 'verified')
	   AND new.remedied_on IS DISTINCT FROM (CASE WHEN tg_op = 'UPDATE' THEN old.remedied_on END) THEN
		RETURN new;
	END IF;

	IF new.status NOT IN ('remedied', 'verified') THEN
		new.remedied_on := NULL;
	ELSIF tg_op = 'UPDATE' AND old.status IN ('remedied', 'verified') THEN
		new.remedied_on := old.remedied_on;
	ELSE
		new.remedied_on := (now() AT TIME ZONE 'Europe/Berlin')::date;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "defect_remedied_on" BEFORE INSERT OR UPDATE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "defect_remedied_on"();--> statement-breakpoint
CREATE FUNCTION "task_done_on"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF current_user <> 'opengewerk_app' AND new.status = 'done'
	   AND new.done_on IS DISTINCT FROM (CASE WHEN tg_op = 'UPDATE' THEN old.done_on END) THEN
		RETURN new;
	END IF;

	IF new.status <> 'done' THEN
		new.done_on := NULL;
	ELSIF tg_op = 'UPDATE' AND old.status = 'done' THEN
		new.done_on := old.done_on;
	ELSE
		new.done_on := (now() AT TIME ZONE 'Europe/Berlin')::date;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "task_done_on" BEFORE INSERT OR UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "task_done_on"();--> statement-breakpoint

-- The years of a kind for the operator of the transaction: what it set, or
-- the law (`recordRetentionYears` in the domain, a test holds both together).
CREATE FUNCTION "record_retention_years"(p_kind text) RETURNS integer
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(
		(SELECT CASE p_kind
		          WHEN 'activity' THEN s.activity_years
		          WHEN 'defect' THEN s.defect_years
		          WHEN 'task' THEN s.task_years
		          WHEN 'reading_person' THEN s.reading_person_years
		          WHEN 'booking_person' THEN s.booking_person_years
		        END
		   FROM public.record_retention_settings s
		  WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid),
		CASE p_kind
		  WHEN 'activity' THEN 6
		  WHEN 'defect' THEN 5
		  WHEN 'task' THEN 1
		  WHEN 'reading_person' THEN 3
		  WHEN 'booking_person' THEN 3
		END)
$$;--> statement-breakpoint

-- The day the retention of a kind ends, counted from the day it began: an
-- activity from the end of that year, everything else from the day itself.
-- The one place the proposal, the deletion, the pass and the locks ask.
CREATE FUNCTION "record_retention_ends"(p_kind text, p_from date) RETURNS date
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT CASE
	         WHEN p_from IS NULL THEN NULL
	         WHEN p_kind = 'activity'
	           THEN make_date(extract(year FROM p_from)::int + public.record_retention_years(p_kind) + 1, 1, 1)
	         ELSE (p_from + make_interval(years => public.record_retention_years(p_kind)))::date
	       END
$$;--> statement-breakpoint

-- Whether the retention of a kind has ended by today, in Germany.
CREATE FUNCTION "record_retention_ended"(p_kind text, p_from date) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(public.record_retention_ends(p_kind, p_from) <= (now() AT TIME ZONE 'Europe/Berlin')::date, false)
$$;--> statement-breakpoint

-- The day an activity ended and the day a defect was remedied, as the ends
-- count them: the day the database wrote, and for a row from before the day
-- of its last change; for a defect from before rather the day of the work
-- order that remedied it, else the day it was checked again.
CREATE FUNCTION "activity_ended_day"(p_activity uuid) RETURNS date
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(a.ended_on, (a.updated_at AT TIME ZONE 'Europe/Berlin')::date)
	  FROM public.activities a
	 WHERE a.id = p_activity AND a.status IN ('done', 'not_performed')
$$;--> statement-breakpoint
CREATE FUNCTION "defect_remedied_day"(p_defect uuid) RETURNS date
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(
	         d.remedied_on,
	         (SELECT a.performed_on FROM public.work_orders w JOIN public.activities a ON a.id = w.activity_id
	           WHERE w.id = d.remedy_work_order_id),
	         d.checked_on,
	         (d.updated_at AT TIME ZONE 'Europe/Berlin')::date)
	  FROM public.defects d
	 WHERE d.id = p_defect AND d.status IN ('remedied', 'verified')
$$;--> statement-breakpoint

-- The day the retention of an activity without evidence ends, or null where
-- it has none: open, begun or signed, already a shell, a part of a collective
-- activity (which goes with it), or an evidence of it or of a part exists.
-- The evidence is looked for in every area: what the person who asks does
-- not see is still there. Volatile for that reason.
CREATE FUNCTION "activity_retention_ends"(p_activity uuid) RETURNS date
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	areas text := current_setting('app.all_areas', true);
	ends date;
BEGIN
	PERFORM set_config('app.all_areas', 'on', true);

	SELECT public.record_retention_ends('activity', public.activity_ended_day(a.id))
	  INTO ends
	  FROM public.activities a
	 WHERE a.id = p_activity
	   AND a.emptied_at IS NULL
	   AND a.collective_id IS NULL
	   AND a.status IN ('done', 'not_performed')
	   AND NOT EXISTS (
		SELECT 1 FROM public.evidence e
		 WHERE e.activity_id = a.id
		    OR e.activity_id IN (SELECT p.id FROM public.activities p WHERE p.collective_id = a.id)
	   );

	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

	RETURN ends;
END;
$$;--> statement-breakpoint

-- The day the retention of a remedied defect ends, or null where it has none.
CREATE FUNCTION "defect_retention_ends"(p_defect uuid) RETURNS date
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT public.record_retention_ends('defect', public.defect_remedied_day(d.id))
	  FROM public.defects d
	 WHERE d.id = p_defect AND d.emptied_at IS NULL AND d.status IN ('remedied', 'verified')
$$;--> statement-breakpoint

-- An activity confirmed in this transaction: its own evidence or that of its
-- parts (#409, #342), or since #412 its own confirmation or that of the
-- collective activity it is a part of.
CREATE OR REPLACE FUNCTION "activity_emptying_of"(p_activity uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_activity IS NOT NULL
	   AND (
		(EXISTS (
			SELECT 1
			  FROM public.evidence e
			  JOIN public.evidence_emptyings c ON c.evidence_id = e.id
			 WHERE (e.activity_id = p_activity
			        OR e.activity_id IN (SELECT a.id FROM public.activities a WHERE a.collective_id = p_activity))
			   AND c.confirmed_at = now()
		 )
		 AND NOT EXISTS (
			SELECT 1
			  FROM public.evidence e
			 WHERE (e.activity_id = p_activity
			        OR e.activity_id IN (SELECT a.id FROM public.activities a WHERE a.collective_id = p_activity))
			   AND e.emptied_at IS NULL
		 ))
		OR EXISTS (
			SELECT 1
			  FROM public.activity_emptyings c
			 WHERE c.confirmed_at = now()
			   AND (c.activity_id = p_activity
			        OR c.activity_id = (SELECT a.collective_id FROM public.activities a WHERE a.id = p_activity))
		)
	   )
$$;--> statement-breakpoint

CREATE FUNCTION "defect_emptying_of"(p_defect uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_defect IS NOT NULL
	   AND EXISTS (SELECT 1 FROM public.defect_emptyings c WHERE c.defect_id = p_defect AND c.confirmed_at = now())
$$;--> statement-breakpoint

-- Before a confirmation is written: whoever writes it leads the operator and
-- names themselves, and the retention has ended. What the database found is
-- written with it, whatever the statement said.
CREATE FUNCTION "activity_emptying_confirmed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	ends date;
BEGIN
	IF current_user = 'opengewerk_app'
	   AND (new.confirmed_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')
	        OR NOT public.session_leads()) THEN
		RAISE EXCEPTION 'Löschen bestätigt nur, wer den Betreiber führt.' USING ERRCODE = 'HT008';
	END IF;

	IF EXISTS (SELECT 1 FROM public.activities a WHERE a.id = new.activity_id AND a.emptied_at IS NOT NULL) THEN
		RAISE EXCEPTION 'Dieser Vorgang ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	ends := public.activity_retention_ends(new.activity_id);

	IF ends IS NULL OR ends > (now() AT TIME ZONE 'Europe/Berlin')::date THEN
		RAISE EXCEPTION 'Die Aufbewahrung dieses Vorgangs ist nicht abgelaufen.' USING ERRCODE = 'HT008';
	END IF;

	SELECT a.property_id, a.area_id INTO new.property_id, new.area_id
	  FROM public.activities a
	 WHERE a.id = new.activity_id;
	new.years := public.record_retention_years('activity');
	new.ended_on := ends;
	new.confirmed_at := now();

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_emptying_confirmed" BEFORE INSERT ON "activity_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "activity_emptying_confirmed"();--> statement-breakpoint

-- After it is written: the activity becomes its shell as in #409, with its
-- parts where it is a collective one, in every area, and the deadline of the
-- end is done.
CREATE FUNCTION "activity_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	areas text := current_setting('app.all_areas', true);
BEGIN
	PERFORM set_config('app.all_areas', 'on', true);

	PERFORM public.empty_the_activity(p.id) FROM public.activities p WHERE p.collective_id = new.activity_id;
	PERFORM public.empty_the_activity(new.activity_id);

	UPDATE public.deadlines
	   SET status = 'done', closed_at = now(), closed_by = new.confirmed_by
	 WHERE activity_id = new.activity_id AND status = 'open';

	PERFORM set_config('app.all_areas', coalesce(areas, ''), true);

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "activity_emptying_empties" AFTER INSERT ON "activity_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "activity_emptying_empties"();--> statement-breakpoint

CREATE FUNCTION "defect_emptying_confirmed"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	ends date;
BEGIN
	IF current_user = 'opengewerk_app'
	   AND (new.confirmed_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')
	        OR NOT public.session_leads()) THEN
		RAISE EXCEPTION 'Löschen bestätigt nur, wer den Betreiber führt.' USING ERRCODE = 'HT008';
	END IF;

	IF EXISTS (SELECT 1 FROM public.defects d WHERE d.id = new.defect_id AND d.emptied_at IS NOT NULL) THEN
		RAISE EXCEPTION 'Dieser Mangel ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	ends := public.defect_retention_ends(new.defect_id);

	IF ends IS NULL OR ends > (now() AT TIME ZONE 'Europe/Berlin')::date THEN
		RAISE EXCEPTION 'Die Aufbewahrung dieses Mangels ist nicht abgelaufen.' USING ERRCODE = 'HT008';
	END IF;

	SELECT d.property_id, d.area_id INTO new.property_id, new.area_id
	  FROM public.defects d
	 WHERE d.id = new.defect_id;
	new.years := public.record_retention_years('defect');
	new.ended_on := ends;
	new.confirmed_at := now();

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "defect_emptying_confirmed" BEFORE INSERT ON "defect_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "defect_emptying_confirmed"();--> statement-breakpoint

-- After it is written: the defect keeps its row with place, days, class,
-- status and what it points at; its description and the note of its check
-- become a fixed sentence, the answer it was found at goes, its photos go
-- for good as the documents of an activity do, and the deadline of the end
-- is done.
CREATE FUNCTION "defect_emptying_empties"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	UPDATE public.defects
	   SET description = 'Gelöscht nach Ablauf der Aufbewahrung.',
	       check_note = CASE WHEN check_note IS NULL THEN NULL ELSE 'Gelöscht nach Ablauf der Aufbewahrung.' END,
	       found_in_answer_id = NULL,
	       emptied_at = now(),
	       device_id = NULL
	 WHERE id = new.defect_id AND emptied_at IS NULL;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Dieser Mangel ist schon gelöscht.' USING ERRCODE = 'HT008';
	END IF;

	PERFORM public.purge_attachment(a.id, 'Gelöscht nach Ablauf der Aufbewahrung')
	   FROM public.attachments a
	  WHERE a.defect_id = new.defect_id;

	UPDATE public.deadlines
	   SET status = 'done', closed_at = now(), closed_by = new.confirmed_by
	 WHERE defect_id = new.defect_id AND kind = 'defect.retention_ends' AND status = 'open';

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "defect_emptying_empties" AFTER INSERT ON "defect_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "defect_emptying_empties"();--> statement-breakpoint

-- A confirmation is kept as written; its area alone follows its record.
CREATE FUNCTION "record_emptying_kept_as_written"() RETURNS trigger
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

	RAISE EXCEPTION 'Die Bestätigung, dass etwas nach Ablauf der Aufbewahrung gelöscht wird, wird nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT009';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "emptying_kept_as_written" BEFORE UPDATE OR DELETE ON "activity_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "record_emptying_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "emptying_kept_whole" BEFORE TRUNCATE ON "activity_emptyings"
	FOR EACH STATEMENT EXECUTE FUNCTION "record_emptying_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "emptying_kept_as_written" BEFORE UPDATE OR DELETE ON "defect_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "record_emptying_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "emptying_kept_whole" BEFORE TRUNCATE ON "defect_emptyings"
	FOR EACH STATEMENT EXECUTE FUNCTION "record_emptying_kept_as_written"();--> statement-breakpoint

-- A defect emptied is not changed any more, and its content goes on no other
-- way: `emptied_at` is set one level below the statement of its confirmation
-- and never by a statement. Its area follows its property, and it is marked
-- removed with the place it hangs on.
CREATE FUNCTION "defect_kept_once_emptied"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.emptied_at IS NULL AND new.emptied_at IS NULL THEN
		RETURN new;
	END IF;

	IF old.emptied_at IS NULL AND pg_trigger_depth() > 1 AND public.defect_emptying_of(old.id) THEN
		RETURN new;
	END IF;

	IF old.emptied_at IS NOT NULL AND pg_trigger_depth() > 1
	   AND (old.area_id IS DISTINCT FROM new.area_id OR (old.deleted_at IS NULL AND new.deleted_at IS NOT NULL))
	   AND (to_jsonb(new) - 'area_id' - 'deleted_at' - 'updated_at' - 'updated_by' - 'device_id' - 'version' - 'change_sequence')
	     = (to_jsonb(old) - 'area_id' - 'deleted_at' - 'updated_at' - 'updated_by' - 'device_id' - 'version' - 'change_sequence') THEN
		RETURN new;
	END IF;

	RAISE EXCEPTION 'Ein Mangel, dessen Inhalt nach Ablauf der Aufbewahrung gelöscht ist, wird nicht mehr geändert.'
		USING ERRCODE = 'HT010';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "defect_kept_once_emptied" BEFORE UPDATE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "defect_kept_once_emptied"();--> statement-breakpoint

-- An emptied activity is marked removed with the place it hangs on, as
-- every activity is (0009): until now none could be at a place that went,
-- since its evidence kept the asset; one without evidence can be. Otherwise
-- as in 0073.
CREATE OR REPLACE FUNCTION "activity_kept_once_emptied"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	stamped text[] := ARRAY['updated_at', 'updated_by', 'version', 'change_sequence'];
BEGIN
	IF old.emptied_at IS NOT NULL THEN
		IF pg_trigger_depth() > 1
		   AND (old.area_id IS DISTINCT FROM new.area_id OR (old.deleted_at IS NULL AND new.deleted_at IS NOT NULL))
		   AND (to_jsonb(new) - 'area_id' - 'deleted_at' - stamped) = (to_jsonb(old) - 'area_id' - 'deleted_at' - stamped) THEN
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

		RAISE EXCEPTION 'Ein Vorgang wird nur nach Ablauf seiner Aufbewahrung gelöscht.'
			USING ERRCODE = 'HT010';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint

-- The photos of a defect go for good while it is emptied, as the documents
-- of an activity do (#409, 0099).
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

-- A task done goes a year after it was done (#412), on the pass of the
-- deadlines, which works for nobody, and on no other way of the application:
-- every other removal of a task marks it. The owner of the tables, which
-- could delete a task before, still may. The deadline that made it lets go
-- of it first.
CREATE FUNCTION "task_goes_after_retention"() RETURNS trigger
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
$$;--> statement-breakpoint
CREATE TRIGGER "task_goes_after_retention" BEFORE DELETE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "task_goes_after_retention"();--> statement-breakpoint
CREATE TRIGGER "tasks_kept_whole" BEFORE TRUNCATE ON "tasks"
	FOR EACH STATEMENT EXECUTE FUNCTION "task_goes_after_retention"();--> statement-breakpoint

-- The person at a reading, a booking and a material at a work order goes
-- three years after it (#412), on the pass of the deadlines and on no other
-- way: only that column, only to null, only once the time has come.
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
$$;--> statement-breakpoint

-- The change log does not copy what goes (as in 0071 and 0073): its triggers
-- on these tables are split, writing a row unconditionally and its change or
-- removal unless it is that one. The confirmations and the settings stand in
-- it, and the removals of the pass with their count.
DROP TRIGGER "audit_changes" ON "defects";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "defects"
	FOR EACH ROW WHEN (NOT public.defect_emptying_of(old.id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "tasks";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "meter_readings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR DELETE ON "meter_readings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_forgotten" AFTER UPDATE ON "meter_readings"
	FOR EACH ROW WHEN (NOT (old.recorded_by IS NOT NULL AND new.recorded_by IS NULL)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "stock_movements";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR DELETE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_forgotten" AFTER UPDATE ON "stock_movements"
	FOR EACH ROW WHEN (NOT (old.booked_by IS NOT NULL AND new.booked_by IS NULL)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_order_materials";--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER DELETE ON "work_order_materials"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_forgotten" AFTER UPDATE ON "work_order_materials"
	FOR EACH ROW WHEN (NOT (old.taken_by IS NOT NULL AND new.taken_by IS NULL)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "defect_emptyings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "record_retention_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "retention_removals"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

ALTER TABLE "activity_emptyings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defect_emptyings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_retention_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retention_removals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT ON "activity_emptyings" TO "opengewerk_app";--> statement-breakpoint
GRANT INSERT ("tenant_id", "property_id", "area_id", "activity_id", "confirmed_by") ON "activity_emptyings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT ON "defect_emptyings" TO "opengewerk_app";--> statement-breakpoint
GRANT INSERT ("tenant_id", "property_id", "area_id", "defect_id", "confirmed_by") ON "defect_emptyings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "record_retention_settings" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "retention_removals" TO "opengewerk_app";--> statement-breakpoint
GRANT DELETE ON "tasks" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("recorded_by") ON "meter_readings" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("booked_by") ON "stock_movements" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("taken_by") ON "work_order_materials" TO "opengewerk_app";
