-- Rolling the corrections of accounts back to how 0017 left the database.
--
-- What it costs an installation that runs it: the rows that say who corrected
-- which name and which address. The names and addresses themselves stay as
-- they are now, and so does what the log of each tenant already says about a
-- correction. The rows go first, with the reason in the same statement, so
-- that the log says why they disappeared; dropping a table writes nothing in
-- any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "account_corrections";--> statement-breakpoint
DROP TABLE "account_corrections";
