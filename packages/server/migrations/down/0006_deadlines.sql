-- Rolling the settings and the passes of the deadline engine back to how 0005
-- left the database.
--
-- What it costs an installation that runs it: every row in both tables.
-- Nothing in this application writes them yet, so on an installation of this
-- version there is none.
--
-- The settings go first, with the reason in the same statement, so that the
-- log of each tenant says why they disappeared. The passes are not in any log,
-- and dropping a table writes nothing in one.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "deadline_settings";--> statement-breakpoint
DROP TABLE "deadline_settings";--> statement-breakpoint
DROP TABLE "deadline_runs";
