-- Rolling the fault reports back to how 0061 left the database.
--
-- What it costs an installation that runs it: every fault report with its
-- category, accepting, merging and rejecting, the link to the work order and
-- the defect it made, and the two rights "Störungen melden" and "Störungen
-- annehmen" in the rows of the roles. The row of the Melder goes where no
-- membership names it; one that a membership names stays, with nothing left
-- but push on the own devices, so that no access names a role that is gone.
-- The two occasions
-- of push stay in their type: PostgreSQL takes no value out of an enum, and a
-- value nobody writes does no harm.

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove(array_remove("rights", 'fault.report'), 'fault.accept'),
       "updated_at" = now()
 WHERE 'fault.report' = ANY ("rights") OR 'fault.accept' = ANY ("rights");--> statement-breakpoint
DELETE FROM "tenant_roles" AS "role"
 WHERE "role"."key" = 'reporter'
   AND NOT EXISTS (
	SELECT 1 FROM "memberships"
	 WHERE "memberships"."tenant_id" = "role"."tenant_id"
	   AND 'reporter' = ANY ("memberships"."roles"));--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "fault_reports";--> statement-breakpoint
DROP TABLE "fault_categories";
