-- Takes the second number of a contact out again, back to how 0090 left
-- things. Run as the superuser, like every rollback.
--
-- What it costs an installation that runs it: the mobile numbers kept so far
-- go with the column; what the log of changes said about them it keeps.
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_mobile_shaped";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "mobile";
