-- Rolling the contacts back to how 0015 left the database.
--
-- What it costs an installation that runs it: every contact of every
-- property. The rows go first, with the reason in the same statement, so that
-- the log of each tenant says why they disappeared; dropping a table writes
-- nothing in any log. The trigger on the properties goes with its function.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "contacts";--> statement-breakpoint
DROP TRIGGER "contacts_follow_deletion" ON "properties";--> statement-breakpoint
DROP FUNCTION "mark_contacts_below"();--> statement-breakpoint
DROP TABLE "contacts";
