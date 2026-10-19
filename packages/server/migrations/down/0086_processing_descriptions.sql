-- Takes the descriptions of the processing out again, back to how 0085 left
-- things, and the right "Auskunft, Verfahrensbeschreibung und Verzeichnis
-- erzeugen" out of every role that holds it. Run as the superuser, like every
-- rollback.
--
-- What it costs an installation that runs it: every description its Leitung
-- made, with the day of each. Download the ones a works council holds before.
DROP TABLE IF EXISTS "processing_descriptions";--> statement-breakpoint
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove("rights", 'privacy.generate'),
       "updated_at" = now()
 WHERE 'privacy.generate' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
