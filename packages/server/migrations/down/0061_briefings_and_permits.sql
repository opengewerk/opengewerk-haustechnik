-- Rolling the briefings and permits back to how 0060 left the database.
--
-- What it costs an installation that runs it: every briefing of a
-- contractor's person with the drawing and the name, and every permit for hot
-- work with what was entered in it. The triggers refuse to empty the tables,
-- so they go as they are.

DROP TABLE "briefings";--> statement-breakpoint
DROP TABLE "work_permits";--> statement-breakpoint
DROP FUNCTION "visit_kept_as_written"();
