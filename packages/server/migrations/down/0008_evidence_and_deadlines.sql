-- Rolling the evidence and the deadlines back to how 0007 left the database.
--
-- What it costs an installation that runs it: every evidence and every
-- deadline. No route of this version writes an evidence; the deadlines follow
-- from it and from the duties, and come back by themselves once both are
-- there again.
--
-- The rows go first, with the reason in the same statement, so that the log of
-- each tenant says why they disappeared; dropping a table writes nothing in
-- any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "deadlines";
DELETE FROM "evidence";--> statement-breakpoint
DROP TABLE "deadlines";--> statement-breakpoint
DROP TABLE "evidence";--> statement-breakpoint
DROP TYPE "public"."deadline_status";--> statement-breakpoint
DROP TYPE "public"."evidence_result";
