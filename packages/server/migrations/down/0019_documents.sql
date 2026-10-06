-- Rolling the documents back to how 0018 left the database.
--
-- What it costs an installation that runs it: every document and every
-- version of one, and so the way to the files they name; the bytes in the
-- store and their rows in `files` stay. The trigger that keeps a version as
-- it was written goes first, so that the rows can go; they go with the reason
-- in the same statement, so that the log of each tenant says why they
-- disappeared, and dropping a table writes nothing in any log. The triggers
-- on the records a document hangs on go with their function, and the two
-- functions of the foundation go last.

DROP TRIGGER "attachment_versions_stay_as_written" ON "attachment_versions";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "attachment_versions";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);
DELETE FROM "attachments";--> statement-breakpoint
DROP TRIGGER "documents_follow_deletion" ON "activities";--> statement-breakpoint
DROP TRIGGER "documents_follow_deletion" ON "assets";--> statement-breakpoint
DROP TRIGGER "documents_follow_deletion" ON "rooms";--> statement-breakpoint
DROP TRIGGER "documents_follow_deletion" ON "buildings";--> statement-breakpoint
DROP TRIGGER "documents_follow_deletion" ON "properties";--> statement-breakpoint
DROP FUNCTION "mark_documents_below"();--> statement-breakpoint
DROP TABLE "attachment_versions";--> statement-breakpoint
DROP TABLE "attachments";--> statement-breakpoint
DROP TYPE "public"."document_kind";--> statement-breakpoint
DROP FUNCTION "attachment_version_stays_as_written"();--> statement-breakpoint
DROP FUNCTION "record_attachment_uploader"();
