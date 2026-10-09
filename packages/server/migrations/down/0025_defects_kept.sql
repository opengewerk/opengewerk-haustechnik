-- Rolling the keeping of defects back to how 0024 left the database.
--
-- What it costs an installation that runs it: the defaults of the classes,
-- the photos at defects as documents of their own place (they are marked as
-- removed, the files stay), the deadlines of defects, which the engine would
-- make again, the day and the note of every check of a defect, and which
-- evidence named a defect. A defect that was checked again goes back to
-- "remedied", which is the last status the database knew without a check.
--
-- The rows go with the reason in the same piece: each piece between the
-- breakpoints runs as a transaction of its own, and the reason holds only
-- until its end (#188). So the log of each tenant says what went and why.
-- Dropping a column or a table writes nothing in any log.

DROP TRIGGER "documents_follow_deletion" ON "defects";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mark_documents_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'buildings' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'activities' THEN
		UPDATE public.attachments SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND activity_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
UPDATE "attachments" SET "deleted_at" = now(), "defect_id" = NULL WHERE "defect_id" IS NOT NULL AND "deleted_at" IS NULL;
UPDATE "attachments" SET "defect_id" = NULL WHERE "defect_id" IS NOT NULL;
DELETE FROM "deadlines" WHERE "defect_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_verified_on_a_day";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_checked_after_found";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_check_note_shaped";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
UPDATE "defects" SET "status" = 'remedied' WHERE "status" = 'verified';
UPDATE "defects" SET "checked_on" = NULL, "check_note" = NULL, "found_in_evidence_id" = NULL
 WHERE "checked_on" IS NOT NULL OR "check_note" IS NOT NULL OR "found_in_evidence_id" IS NOT NULL;
DELETE FROM "defect_class_terms";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_hang_on_one_record";--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_hang_on_one_record" CHECK (num_nonnulls("attachments"."building_id", "attachments"."room_id", "attachments"."asset_id", "attachments"."activity_id") <= 1);--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_defect_of_their_property";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_defect_of_their_property";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_named_in_an_evidence_of_their_property";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_place";--> statement-breakpoint
DROP INDEX "attachments_defect_idx";--> statement-breakpoint
DROP INDEX "deadlines_defect_idx";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "defect_id";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "defect_id";--> statement-breakpoint
ALTER TABLE "deadlines" ALTER COLUMN "duty_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "check_note";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "checked_on";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "found_in_evidence_id";--> statement-breakpoint
DROP TABLE "defect_class_terms";
