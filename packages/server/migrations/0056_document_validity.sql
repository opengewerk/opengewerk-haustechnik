-- The validity of a document (#327, sections 2.4, 4.3 and 4.10 of the
-- concept).
--
-- `attachment_versions.valid_until`: the day a version expires, or for a risk
-- assessment the day it is to be reviewed. Its own: a new version brings its
-- own day, or none. `deadlines.attachment_id` is the sources `document` and
-- `risk_assessment` of the deadline engine: the document whose newest version
-- names a day, in the area of the document, which the deadline follows.
-- `document_kind` gets the risk assessment.
--
-- The keys of a deadline onto its document are laid while neither table is
-- under FORCE, as 0051 does it: an installation migrates as the owner, and
-- under FORCE PostgreSQL checks a key only against what the policies show.

ALTER TYPE "public"."document_kind" ADD VALUE 'risk_assessment';--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_area_key" UNIQUE("tenant_id","id","area_id");--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_document" FOREIGN KEY ("tenant_id","attachment_id","area_id") REFERENCES "public"."attachments"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_document_of_their_property" FOREIGN KEY ("tenant_id","attachment_id","property_id") REFERENCES "public"."attachments"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deadlines_attachment_idx" ON "deadlines" USING btree ("tenant_id","attachment_id");--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id") = 1);
