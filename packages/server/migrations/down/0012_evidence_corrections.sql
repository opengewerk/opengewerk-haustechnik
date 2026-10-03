-- Rolling the corrections and the declarations of invalidity back to how 0011
-- left the database.
--
-- What it costs an installation that runs it: every declaration of
-- invalidity, and for every correction the evidence it replaces and why. A
-- correction stays as an evidence of its own; its frozen state still names
-- the evidence it replaced, in the second version of the state, which the
-- application before this update does not read. The triggers go first, so
-- that the rows can go; the rows go with the reason in the same statement, so
-- that the log of each tenant says why they disappeared.

DROP TRIGGER "voiding_kept_whole" ON "evidence_voidings";--> statement-breakpoint
DROP TRIGGER "voiding_kept_as_written" ON "evidence_voidings";--> statement-breakpoint
DROP FUNCTION "voiding_kept_as_written"();--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "evidence_voidings";--> statement-breakpoint
DROP TABLE "evidence_voidings";--> statement-breakpoint
DROP INDEX "evidence_replaced_once";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_replaces_one_of_its_duty";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_not_its_own_replacement";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_replacement_reason_shaped";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_replacement_with_a_reason";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_tenant_id_property_key";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_tenant_id_property_duty_key";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "replacement_reason";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "replaces_evidence_id";
