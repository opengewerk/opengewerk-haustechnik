-- Rolling the areas of an invitation back to how 0013 left the database.
--
-- What it costs an installation that runs it: what its open invitations say
-- about areas. Whoever takes one of them up afterwards begins with what the
-- database gives a new membership, and the Leitung names their areas then.
--
-- The rows go first, with the reason in the same statement, so that the log of
-- each tenant says why they disappeared. Dropping a table writes nothing in
-- any log.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "invitation_areas";
DELETE FROM "invitation_area_choices";--> statement-breakpoint
DROP TABLE "invitation_areas";--> statement-breakpoint
DROP TABLE "invitation_area_choices";
