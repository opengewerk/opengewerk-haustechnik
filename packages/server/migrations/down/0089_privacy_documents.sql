-- Takes the documents on data protection and what the Leitung wrote for the
-- record out again, back to how 0088 left things. Run as the superuser, like
-- every rollback.
--
-- What it costs an installation that runs it: every record, measures and
-- deletion concept its Leitung made, with the day of each, and the purposes,
-- legal bases and recipients it wrote. Download the documents that were
-- handed out before.
DROP TABLE IF EXISTS "privacy_documents";--> statement-breakpoint
DROP TABLE IF EXISTS "processing_record_activities";--> statement-breakpoint
DROP TABLE IF EXISTS "processing_record_settings";
