-- Takes back 0105_signed_print_level: the level of a PDF with a higher signature.
ALTER TABLE "evidence_signed_prints" DROP CONSTRAINT "evidence_signed_prints_level_known";--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" DROP COLUMN "stated_level";
