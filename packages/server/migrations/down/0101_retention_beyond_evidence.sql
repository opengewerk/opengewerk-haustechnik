-- Takes back 0101_retention_beyond_evidence: the functions and locks as they
-- were, the change log in one trigger again, the grants, the tables and the
-- columns. What went after its retention cannot come back; while anything
-- went, this does not run.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "activity_emptyings") OR EXISTS (SELECT 1 FROM "defect_emptyings")
	   OR EXISTS (SELECT 1 FROM "retention_removals") THEN
		RAISE EXCEPTION 'Nach Ablauf der Aufbewahrung ist schon etwas gelöscht; 0101 lässt sich nicht zurücknehmen.';
	END IF;
END;
$$;--> statement-breakpoint
REVOKE UPDATE ("taken_by") ON "work_order_materials" FROM "opengewerk_app";--> statement-breakpoint
REVOKE UPDATE ("booked_by") ON "stock_movements" FROM "opengewerk_app";--> statement-breakpoint
REVOKE UPDATE ("recorded_by") ON "meter_readings" FROM "opengewerk_app";--> statement-breakpoint
REVOKE DELETE ON "tasks" FROM "opengewerk_app";--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_forgotten" ON "work_order_materials";--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "work_order_materials";--> statement-breakpoint
CREATE TRIGGER "audit_changes_unless_emptied" AFTER UPDATE OR DELETE ON "work_order_materials"
	FOR EACH ROW WHEN (NOT public.activity_emptying_of(old.activity_id)) EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_forgotten" ON "stock_movements";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "stock_movements";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_forgotten" ON "meter_readings";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "meter_readings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "meter_readings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "tasks";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "defects";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "defects";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "defects"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
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
CREATE OR REPLACE FUNCTION "booking_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Buchung im Lager wird nicht geändert und nicht gelöscht. Was nicht stimmt, berichtigt eine Zählung.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
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
	END IF;

	RAISE EXCEPTION 'Ein Zählerstand wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Stand, der ihn nennt.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "application_attachment_may_go"(p_attachment uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT EXISTS (
		SELECT 1
		  FROM public.attachments a
		 WHERE a.id = p_attachment AND public.activity_emptying_of(a.activity_id)
	)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "activity_emptying_of"(p_activity uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT p_activity IS NOT NULL
	   AND EXISTS (
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
	   )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "activity_kept_once_emptied"() RETURNS trigger
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
DROP TRIGGER "tasks_kept_whole" ON "tasks";--> statement-breakpoint
DROP TRIGGER "task_goes_after_retention" ON "tasks";--> statement-breakpoint
DROP TRIGGER "defect_kept_once_emptied" ON "defects";--> statement-breakpoint
DROP TRIGGER "task_done_on" ON "tasks";--> statement-breakpoint
DROP TRIGGER "defect_remedied_on" ON "defects";--> statement-breakpoint
DROP TRIGGER "activity_ended_on" ON "activities";--> statement-breakpoint
DROP TABLE "activity_emptyings";--> statement-breakpoint
DROP TABLE "defect_emptyings";--> statement-breakpoint
DROP TABLE "record_retention_settings";--> statement-breakpoint
DROP TABLE "retention_removals";--> statement-breakpoint
DROP FUNCTION "task_goes_after_retention"();--> statement-breakpoint
DROP FUNCTION "defect_kept_once_emptied"();--> statement-breakpoint
DROP FUNCTION "record_emptying_kept_as_written"();--> statement-breakpoint
DROP FUNCTION "defect_emptying_empties"();--> statement-breakpoint
DROP FUNCTION "defect_emptying_confirmed"();--> statement-breakpoint
DROP FUNCTION "activity_emptying_empties"();--> statement-breakpoint
DROP FUNCTION "activity_emptying_confirmed"();--> statement-breakpoint
DROP FUNCTION "defect_emptying_of"(uuid);--> statement-breakpoint
DROP FUNCTION "defect_retention_ends"(uuid);--> statement-breakpoint
DROP FUNCTION "activity_retention_ends"(uuid);--> statement-breakpoint
DROP FUNCTION "defect_remedied_day"(uuid);--> statement-breakpoint
DROP FUNCTION "activity_ended_day"(uuid);--> statement-breakpoint
DROP FUNCTION "record_retention_ended"(text, date);--> statement-breakpoint
DROP FUNCTION "record_retention_ends"(text, date);--> statement-breakpoint
DROP FUNCTION "record_retention_years"(text);--> statement-breakpoint
DROP FUNCTION "task_done_on"();--> statement-breakpoint
DROP FUNCTION "defect_remedied_on"();--> statement-breakpoint
DROP FUNCTION "activity_ended_on"();--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_activity";--> statement-breakpoint
DROP INDEX "deadlines_activity_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "activity_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id", "deadlines"."evidence_id", "deadlines"."member_user_id") = 1);--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "done_on";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "emptied_at";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "remedied_on";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "ended_on";--> statement-breakpoint
ALTER TABLE "work_order_materials" ALTER COLUMN "taken_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "booked_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meter_readings" ALTER COLUMN "recorded_by" SET NOT NULL;
