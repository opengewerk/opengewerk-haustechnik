-- Rolling the taken-over deadlines back to how 0046 left the database.
--
-- What it costs an installation that runs it: the next due day a list named
-- for each evidence taken over, so that the duty of such an evidence counts
-- from the day of the evidence again; the mark "Altbestand" at every document
-- taken over; and the entry of each import of running deadlines, for which
-- 0046 has no kind, with the reason in the log of each tenant. The duties,
-- the evidence and the documents themselves stay. The frozen state of an
-- evidence written since is of a version the release before does not read:
-- it shows such an evidence again once the update is run anew.

ALTER TABLE "evidence" DROP CONSTRAINT "evidence_next_due_of_the_holdings";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "next_due_on";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "legacy";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "imports" WHERE "kind" = 'deadlines';--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_kind_known";--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_kind_known" CHECK ("kind" in ('structure', 'assets'));
