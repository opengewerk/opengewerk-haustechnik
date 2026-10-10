-- Rolling the document that bears the interval of a duty back to how 0036
-- left the database.
--
-- What it costs an installation that runs it: which document each duty named
-- for its interval, and the version it pointed at. The duties stay, with
-- their interval and its reason; the documents and their versions stay.
--
-- The references are emptied first, with the reason in the same statement,
-- so that the log of each tenant says that they went and why. Dropping a
-- column writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
UPDATE "duties" SET "interval_document_id" = NULL, "interval_document_version_id" = NULL WHERE "interval_document_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_interval_document_whole";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_interval_document_version_of_it";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_interval_document_of_their_property";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "interval_document_version_id";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "interval_document_id";--> statement-breakpoint
ALTER TABLE "attachment_versions" DROP CONSTRAINT "attachment_versions_of_their_document";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_on_their_property";
