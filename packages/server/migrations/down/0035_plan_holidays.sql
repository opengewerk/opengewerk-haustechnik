-- Rolling the holidays of a plan back to how 0034 left the database.
--
-- What it costs an installation that runs it: which plans leave out the
-- statutory public holidays. Their rounds that stand stay as they are; from
-- then on a plan makes a round on a holiday like on any day.

ALTER TABLE "round_plans" DROP COLUMN "skip_holidays";
