-- The level a PDF with a higher signature states for itself (#526, section 2.6
-- of the concept): qualified where the certificate of its signer says it is an
-- EU qualified one (QcCompliance of ETSI EN 319 412-5), advanced otherwise. No
-- trusted list is asked, and the screen says so. Empty for a PDF filed before.
--
-- **Fits the version before it.** It writes no level, which the column takes.

ALTER TABLE "evidence_signed_prints" ADD COLUMN "stated_level" text;--> statement-breakpoint
ALTER TABLE "evidence_signed_prints" ADD CONSTRAINT "evidence_signed_prints_level_known" CHECK ("evidence_signed_prints"."stated_level" is null or "evidence_signed_prints"."stated_level" in ('qualified', 'advanced'));