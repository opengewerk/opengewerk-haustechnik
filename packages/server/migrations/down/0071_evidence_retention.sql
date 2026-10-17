-- Takes back 0071_evidence_retention: the locks and the change log as they
-- were, the grants, the functions, the two tables, the key and column on the
-- deadlines and the column and checks of the shell. An evidence already
-- emptied cannot be filled again; while there is one, this does not run.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "evidence" WHERE "emptied_at" IS NOT NULL) THEN
		RAISE EXCEPTION 'Es gibt gelöschte Nachweise; 0071 lässt sich nicht zurücknehmen.';
	END IF;
END;
$$;--> statement-breakpoint
REVOKE DELETE ON "prints" FROM "opengewerk_app";--> statement-breakpoint
REVOKE UPDATE ("reason") ON "evidence_voidings" FROM "opengewerk_app";--> statement-breakpoint
REVOKE UPDATE ("state", "fingerprint", "emptied_at", "performed_by", "examiner", "examiner_organisation", "contractor_id", "written_by", "result_reason", "replacement_reason") ON "evidence" FROM "opengewerk_app";--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "evidence";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "evidence";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "evidence"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "evidence_voidings";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "evidence_voidings";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "evidence_voidings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
DROP TRIGGER "audit_changes_unless_emptied" ON "prints";--> statement-breakpoint
DROP TRIGGER "audit_changes" ON "prints";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "prints"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
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

	RAISE EXCEPTION 'Ein eingefrorener Stand und sein PDF werden nicht geändert und nicht gelöscht.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
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
	END IF;

	RAISE EXCEPTION 'Eine Ungültigerklärung wird nicht geändert und nicht gelöscht. Der Nachweis bleibt mit ihr lesbar.'
		USING ERRCODE = 'HT006';
END;
$$;--> statement-breakpoint
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
	END IF;

	RAISE EXCEPTION 'Ein Nachweis wird nicht geändert und nicht gelöscht. Berichtigt wird er durch einen neuen Nachweis, der ihn nennt.'
		USING ERRCODE = 'HT003';
END;
$$;--> statement-breakpoint
DROP TABLE "evidence_emptyings";--> statement-breakpoint
DROP TABLE "evidence_retention_settings";--> statement-breakpoint
DROP FUNCTION "emptying_kept_as_written"();--> statement-breakpoint
DROP FUNCTION "evidence_emptying_empties"();--> statement-breakpoint
DROP FUNCTION "evidence_emptying_confirmed"();--> statement-breakpoint
DROP FUNCTION "evidence_emptying_of"(uuid);--> statement-breakpoint
DROP FUNCTION "session_leads"();--> statement-breakpoint
DROP FUNCTION "evidence_retention_ends"(uuid);--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_evidence";--> statement-breakpoint
DROP INDEX "deadlines_evidence_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "evidence_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id") = 1);--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_emptied_is_empty";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_written_by_somebody";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_not_performed_with_a_reason";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_report_by_an_examiner";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_performed_by_somebody";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_replacement_with_a_reason";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "emptied_at";--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "written_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_not_performed_with_a_reason" CHECK (("evidence"."result" = 'not_performed') = ("evidence"."result_reason" is not null));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_report_by_an_examiner" CHECK ("evidence"."origin" <> 'report' or "evidence"."examiner" is not null);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_performed_by_somebody" CHECK ("evidence"."origin" = 'legacy' or num_nonnulls("evidence"."performed_by", "evidence"."examiner") >= 1);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_replacement_with_a_reason" CHECK (("evidence"."replaces_evidence_id" is null) = ("evidence"."replacement_reason" is null));
