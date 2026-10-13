-- The history of the meters and the templates of the rounds of a predecessor
-- application (#130, second part). A reading taken over from a list says so:
-- nobody here read it, and "Von Hand" beside the name of whoever imported the
-- list would say somebody did. The two imports are kinds of import of their
-- own, each with its entry in the change log.
ALTER TYPE "public"."meter_reading_source" ADD VALUE 'taken_over';--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_kind_known";--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_kind_known" CHECK ("kind" in ('structure', 'assets', 'deadlines', 'meters', 'templates'));