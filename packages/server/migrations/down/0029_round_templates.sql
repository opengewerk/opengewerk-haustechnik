-- Rolling the templates of the rounds back to how 0028 left the database.
--
-- What it costs an installation that runs it: every template and every
-- version of one. A round that names a template keeps its key and its
-- version, and no form is found for it any more. The rows go first, with the
-- reason in the same statement, so that the log of each tenant says why they
-- disappeared; dropping a table writes nothing in any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "round_template_versions";--> statement-breakpoint
DELETE FROM "round_templates";--> statement-breakpoint
DROP TABLE "round_template_versions";--> statement-breakpoint
DROP TABLE "round_templates";
