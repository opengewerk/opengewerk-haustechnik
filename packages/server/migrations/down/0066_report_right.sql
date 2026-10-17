-- Rolling the right "Auswertungen ansehen" back to how 0065 left the
-- database: out of the rows of every role that holds it.
--
-- What it costs an installation that runs it: the right, in the shipped roles
-- and in any role of its own that was given it. There is nothing else.

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove("rights", 'report.read'),
       "updated_at" = now()
 WHERE 'report.read' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
