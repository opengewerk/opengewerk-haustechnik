-- The evidence as it is written down (ADR 0004, opengewerk-haustechnik#26):
-- its number from the sequence of the evidence, what it came from (a
-- protocol, a report, a point of a round, a work order or the holdings of a
-- predecessor), the activity it came from, who did it (a person of the
-- operator, or an examiner with the organisation from outside), the reason a
-- result "not performed" has, who wrote it down and when, its frozen state as
-- JSON and the fingerprint over the canonical form of that state. The state
-- stands on the row and not in a table beside it: an evidence comes about only
-- when it is written down, there is no draft of it, and in one row the two
-- cannot come apart.
--
-- Three locks, each enough on its own (ADR 0004, point 12): the application
-- role has neither UPDATE nor DELETE, since 0008; a trigger refuses every
-- change and every removal and a TRUNCATE to every role, the owner and a
-- superuser included; and the row stands with its fingerprint in the log,
-- whose chain shows a change that happened all the same. The one change the
-- trigger lets through is the area of the row, when its property moves into
-- another area and the key takes the row along; the key holds the area to the
-- one of the property, so nothing else can come through that way.
--
-- An asset with an evidence is taken out of service and not deleted (ADR 0002,
-- point 17, ADR 0004, point 13): a trigger refuses to mark it, and so the
-- marking of the building, room or property it stands in as well, by the
-- trigger that marks the assets below them. A duty with an evidence may be
-- marked; the reference stays valid, and what it was stands in the state.
--
-- Everything from the type down to the last CHECK is what drizzle-kit
-- generated from the schema. What follows is written by hand.
--
-- **Fits the version before it.** That version writes no evidence, and the
-- columns are new.

CREATE TYPE "public"."evidence_origin" AS ENUM('protocol', 'report', 'round_point', 'work_order', 'legacy');--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "result_reason" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "origin" "evidence_origin" NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "performed_by" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "examiner" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "examiner_organisation" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "written_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "written_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "state" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_from_an_activity_of_its_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_performed_by_somebody_here" FOREIGN KEY ("tenant_id","performed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_written_by_somebody_here" FOREIGN KEY ("tenant_id","written_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_number_once" ON "evidence" USING btree ("tenant_id","number");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_number_shaped" CHECK ("evidence"."number" = btrim("evidence"."number") and char_length("evidence"."number") between 1 and 40);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_result_reason_shaped" CHECK ("evidence"."result_reason" is null or ("evidence"."result_reason" = btrim("evidence"."result_reason") and char_length("evidence"."result_reason") between 1 and 500));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_not_performed_with_a_reason" CHECK (("evidence"."result" = 'not_performed') = ("evidence"."result_reason" is not null));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_examiner_shaped" CHECK ("evidence"."examiner" is null or ("evidence"."examiner" = btrim("evidence"."examiner") and char_length("evidence"."examiner") between 1 and 200));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_examiner_organisation_shaped" CHECK ("evidence"."examiner_organisation" is null or ("evidence"."examiner_organisation" = btrim("evidence"."examiner_organisation") and char_length("evidence"."examiner_organisation") between 1 and 200));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_examiner_with_organisation" CHECK (("evidence"."examiner" is null) = ("evidence"."examiner_organisation" is null));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_report_by_an_examiner" CHECK ("evidence"."origin" <> 'report' or "evidence"."examiner" is not null);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_performed_by_somebody" CHECK ("evidence"."origin" = 'legacy' or num_nonnulls("evidence"."performed_by", "evidence"."examiner") >= 1);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_performed_by_one" CHECK (num_nonnulls("evidence"."performed_by", "evidence"."examiner") <= 1);--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_activity_as_its_origin_says" CHECK (("evidence"."origin" not in ('protocol', 'round_point', 'work_order') or "evidence"."activity_id" is not null)
        and ("evidence"."origin" <> 'legacy' or "evidence"."activity_id" is null));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_state_shaped" CHECK (jsonb_typeof("evidence"."state") = 'object'
        and coalesce(jsonb_typeof("evidence"."state" -> 'version') = 'number', false));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_fingerprint_shaped" CHECK ("evidence"."fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- No change and no removal, for any role. The area alone may follow the
-- property, and only from the key: then the trigger runs one level deeper than
-- the statement, and every other column is what it was.
CREATE FUNCTION "evidence_stays_as_written"() RETURNS trigger
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
CREATE TRIGGER "evidence_stays_as_written" BEFORE UPDATE OR DELETE ON "evidence"
	FOR EACH ROW EXECUTE FUNCTION "evidence_stays_as_written"();--> statement-breakpoint
CREATE TRIGGER "evidence_stays_whole" BEFORE TRUNCATE ON "evidence"
	FOR EACH STATEMENT EXECUTE FUNCTION "evidence_stays_as_written"();--> statement-breakpoint

-- An asset with an evidence is not marked. Asked of the evidence of the duties
-- at the asset. Not SECURITY DEFINER: whoever may mark the asset sees its
-- area, and the evidence there with it; as the owner of the tables, under
-- FORCE, the function would see no evidence at all.
CREATE FUNCTION "assets_with_evidence_stay"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		  FROM public.evidence e
		  JOIN public.duties d ON d.tenant_id = e.tenant_id AND d.id = e.duty_id
		 WHERE d.tenant_id = new.tenant_id AND d.asset_id = new.id
	) THEN
		RAISE EXCEPTION 'Eine Anlage mit Nachweis wird zurückgebaut und nicht gelöscht; ihre Nachweise bleiben bei ihr.'
			USING ERRCODE = 'HT004';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "assets_with_evidence_stay" BEFORE UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW
	WHEN (old.deleted_at IS NULL AND new.deleted_at IS NOT NULL)
	EXECUTE FUNCTION "assets_with_evidence_stay"();
