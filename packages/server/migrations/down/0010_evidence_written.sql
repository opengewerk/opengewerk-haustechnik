-- Rolling the written evidence back to how 0009 left the database.
--
-- What it costs an installation that runs it: the number, the origin, who did
-- it, who wrote it down, the frozen state and the fingerprint of every
-- evidence, and the locks on it. The rows themselves stay, as the rows of the
-- day, the duty and the result that 0008 knows. The triggers go first, so
-- that nothing below meets them.

DROP TRIGGER "assets_with_evidence_stay" ON "assets";--> statement-breakpoint
DROP FUNCTION "assets_with_evidence_stay"();--> statement-breakpoint
DROP TRIGGER "evidence_stays_whole" ON "evidence";--> statement-breakpoint
DROP TRIGGER "evidence_stays_as_written" ON "evidence";--> statement-breakpoint
DROP FUNCTION "evidence_stays_as_written"();--> statement-breakpoint
DROP INDEX "evidence_number_once";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_from_an_activity_of_its_property";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_performed_by_somebody_here";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_written_by_somebody_here";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "result_reason";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "number";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "origin";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "activity_id";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "performed_by";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "examiner";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "examiner_organisation";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "written_by";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "written_at";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "fingerprint";--> statement-breakpoint
DROP TYPE "public"."evidence_origin";
