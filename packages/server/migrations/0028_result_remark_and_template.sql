-- What is said with a result, and the template of a protocol (#108, section
-- 4.4 of the concept).
--
-- `activity_duties.remark` holds what the person says with the result of a
-- duty: what a duty kind without a form has to say beside its result, and a
-- word on any other. Trimmed and at most as long as the remark at a point of a
-- form, or null; no row has one before this.
--
-- `activities.template_on` is the day the protocol was performed whose
-- answers the activity took as its template, written by the server when it
-- makes the activity; null where nothing was taken, as for every activity
-- made before this.
ALTER TABLE "activities" ADD COLUMN "template_on" date;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "activity_duties" ADD CONSTRAINT "activity_duties_remark_shaped" CHECK ("activity_duties"."remark" is null or ("activity_duties"."remark" = btrim("activity_duties"."remark") and char_length("activity_duties"."remark") between 1 and 4000));
