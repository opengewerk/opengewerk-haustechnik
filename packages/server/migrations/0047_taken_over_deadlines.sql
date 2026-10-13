ALTER TABLE "evidence" ADD COLUMN "next_due_on" date;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "legacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_next_due_of_the_holdings" CHECK ("evidence"."next_due_on" is null
        or ("evidence"."origin" = 'legacy' and "evidence"."next_due_on" > "evidence"."performed_on"));--> statement-breakpoint
-- The import of the running deadlines of a predecessor application is a kind
-- of import of its own (#130). The check is taken down and put up again by
-- hand: a check that only changes its expression is not seen by the tool.
ALTER TABLE "imports" DROP CONSTRAINT "imports_kind_known";--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_kind_known" CHECK ("kind" in ('structure', 'assets', 'deadlines'));
