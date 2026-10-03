-- Rolling the files and the mail server back to how 0004 left the database.
--
-- What it costs an installation that runs it: every row in both tables. Nothing
-- in this application writes them yet, so on an installation of this version
-- there is none; the bytes behind a file stay in the store, where nothing
-- points at them any more. A sealed password stays in `secrets` under the
-- purpose `smtp_password` and is no longer read.
--
-- The rows go first, with the reason in the same statement, so that the log of
-- each tenant says why they disappeared. Dropping a table writes nothing in any
-- log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "mail_settings";
DELETE FROM "files";--> statement-breakpoint
DROP TABLE "mail_settings";--> statement-breakpoint
DROP TABLE "files";--> statement-breakpoint
DROP TYPE "public"."mail_security";
