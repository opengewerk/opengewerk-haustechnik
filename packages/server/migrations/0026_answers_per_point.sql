-- The answers to the points of the form of an activity (#106, section 2.7 of
-- the concept, ADR 0006, point 7): one row per point, so that two people at
-- different points merge and two at the same point are a conflict.
--
-- `activities` names the form it is filled in and its version, both or
-- neither; the server writes them when it makes an activity. No activity
-- before this has a form, so no row breaks the check.
--
-- `activity_answers` holds one row per point: the field, and for a field of a
-- repeating group the group and the block, once among the rows that are not
-- marked. A photo is a document at the same activity, which the key over
-- `attachments_at_their_activity` says; that unique key comes before the key
-- that leans on it.
--
-- `defects` names the answer a defect came of, a check point not in order or
-- a measured value outside its limit, in the activity it was noticed in, once
-- per answer among the defects that are not marked.
--
-- Once an activity is signed, nothing changes its answers, for any role
-- (`answers_kept_once_signed`, error class HT007).
CREATE TYPE "public"."check_point_result" AS ENUM('ok', 'not_ok', 'not_applicable', 'not_possible');--> statement-breakpoint
CREATE TABLE "activity_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"group_key" text,
	"block_key" text,
	"field_key" text NOT NULL,
	"value" text,
	"result" "check_point_result",
	"remark" text,
	"attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_answers_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "activity_answers_place" UNIQUE("tenant_id","id","property_id","activity_id"),
	CONSTRAINT "activity_answers_field_key_shaped" CHECK ("activity_answers"."field_key" ~ '^[a-z][a-z0-9_]*$' and char_length("activity_answers"."field_key") <= 64),
	CONSTRAINT "activity_answers_group_key_shaped" CHECK ("activity_answers"."group_key" is null or ("activity_answers"."group_key" ~ '^[a-z][a-z0-9_]*$' and char_length("activity_answers"."group_key") <= 64)),
	CONSTRAINT "activity_answers_block_key_shaped" CHECK ("activity_answers"."block_key" is null or ("activity_answers"."block_key" ~ '^[A-Za-z0-9_-]+$' and char_length("activity_answers"."block_key") <= 64)),
	CONSTRAINT "activity_answers_in_a_block_of_a_group" CHECK (("activity_answers"."group_key" is null) = ("activity_answers"."block_key" is null)),
	CONSTRAINT "activity_answers_value_shaped" CHECK ("activity_answers"."value" is null or char_length("activity_answers"."value") between 1 and 50000),
	CONSTRAINT "activity_answers_remark_shaped" CHECK ("activity_answers"."remark" is null or ("activity_answers"."remark" = btrim("activity_answers"."remark") and char_length("activity_answers"."remark") between 1 and 4000)),
	CONSTRAINT "activity_answers_value_or_result" CHECK ("activity_answers"."value" is null or "activity_answers"."result" is null),
	CONSTRAINT "activity_answers_say_something" CHECK (num_nonnulls("activity_answers"."value", "activity_answers"."result", "activity_answers"."attachment_id") >= 1)
);
--> statement-breakpoint
ALTER TABLE "activity_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "form_key" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "form_version" integer;--> statement-breakpoint
ALTER TABLE "defects" ADD COLUMN "found_in_answer_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_their_activity" UNIQUE("tenant_id","id","property_id","activity_id");--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_of_an_activity_of_their_property" FOREIGN KEY ("tenant_id","activity_id","property_id") REFERENCES "public"."activities"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_photo_at_their_activity" FOREIGN KEY ("tenant_id","attachment_id","property_id","activity_id") REFERENCES "public"."attachments"("tenant_id","id","property_id","activity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_answers_activity_idx" ON "activity_answers" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_answers_once" ON "activity_answers" USING btree ("tenant_id","activity_id",coalesce("group_key", ''),coalesce("block_key", ''),"field_key") WHERE "activity_answers"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_from_an_answer_of_their_activity" FOREIGN KEY ("tenant_id","found_in_answer_id","property_id","found_in_activity_id") REFERENCES "public"."activity_answers"("tenant_id","id","property_id","activity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "defects_once_per_answer" ON "defects" USING btree ("tenant_id","found_in_answer_id") WHERE "defects"."found_in_answer_id" is not null and "defects"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_form_with_its_version" CHECK (("activities"."form_key" is null) = ("activities"."form_version" is null));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_form_shaped" CHECK ("activities"."form_key" is null or ("activities"."form_key" ~ '^[a-z][a-z0-9_.-]*$' and char_length("activities"."form_key") <= 130 and "activities"."form_version" >= 1));--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_answer_in_their_activity" CHECK ("defects"."found_in_answer_id" is null or "defects"."found_in_activity_id" is not null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activity_answers" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("activity_answers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("activity_answers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "activity_answers" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "activity_answers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "activity_answers" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No answer is given, changed or removed once its activity is signed, by any
-- role, and the table is not emptied. Signed is a signature that no rejection
-- of its work order came after, by the moment the server took each, as
-- `validSignatures` reads it: a work order turned back goes on, and its
-- answers with it. The area alone may follow the property, from the key: then
-- the trigger runs one level deeper than the statement, and every other
-- column is what it was. It runs before `stamp_sync_columns`, triggers of one
-- kind running in the order of their names.
--
-- Not SECURITY DEFINER: whoever may change an answer sees its area, and the
-- signatures there with it; as the owner of the tables, under FORCE, the
-- function would see no signature at all.
CREATE FUNCTION "answers_kept_once_signed"() RETURNS trigger
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
CREATE TRIGGER "answers_kept_once_signed" BEFORE INSERT OR UPDATE OR DELETE ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "answers_kept_once_signed"();--> statement-breakpoint
CREATE TRIGGER "answers_kept_whole" BEFORE TRUNCATE ON "activity_answers"
	FOR EACH STATEMENT EXECUTE FUNCTION "answers_kept_once_signed"();
