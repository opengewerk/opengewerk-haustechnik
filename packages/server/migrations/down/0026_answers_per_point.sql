-- Rolling the answers per point back to how 0025 left the database.
--
-- What it costs an installation that runs it: every answer to a point of a
-- form, the form an activity was filled in, and which answer a defect came
-- of. The defects stay, with what they say; the evidence keeps the answers in
-- its frozen state, which nothing here touches.
--
-- The trigger that keeps the answers of a signed activity goes first, or it
-- would refuse their removal. Then the rows go, with the reason in the same
-- statement, which runs as one transaction, so that the log of each tenant
-- says what went and why; a reason set in a statement of its own ends with
-- it. Dropping a column or a table writes nothing in any log.

DROP TRIGGER "answers_kept_whole" ON "activity_answers";--> statement-breakpoint
DROP TRIGGER "answers_kept_once_signed" ON "activity_answers";--> statement-breakpoint
DROP FUNCTION "answers_kept_once_signed"();--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
UPDATE "defects" SET "found_in_answer_id" = NULL WHERE "found_in_answer_id" IS NOT NULL;
DELETE FROM "activity_answers";
UPDATE "activities" SET "form_key" = NULL, "form_version" = NULL WHERE "form_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_answer_in_their_activity";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT "defects_from_an_answer_of_their_activity";--> statement-breakpoint
DROP INDEX "defects_once_per_answer";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN "found_in_answer_id";--> statement-breakpoint
DROP TABLE "activity_answers";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_their_activity";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_form_shaped";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_form_with_its_version";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "form_version";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "form_key";--> statement-breakpoint
DROP TYPE "public"."check_point_result";
