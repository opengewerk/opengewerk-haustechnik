-- Rolling the contractors back to how 0056 left the database.
--
-- What it costs an installation that runs it: every firm of the list, the
-- firm a duty, an activity and an evidence named beside its text, and the two
-- rights "Fremdfirmen ansehen" and "Fremdfirmen pflegen" in the rows of the
-- roles. What stood as text at a duty, an activity and an evidence stays.

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove(array_remove("rights", 'contractor.read'), 'contractor.write'),
       "updated_at" = now()
 WHERE 'contractor.read' = ANY ("rights") OR 'contractor.write' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_contractor_for_a_contractor";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_contractor_for_a_contractor";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_name_their_contractor";--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_name_their_contractor";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_name_their_contractor";--> statement-breakpoint
DROP INDEX "duties_contractor_idx";--> statement-breakpoint
DROP INDEX "evidence_contractor_idx";--> statement-breakpoint
DROP INDEX "activities_contractor_idx";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "contractor_id";--> statement-breakpoint
ALTER TABLE "evidence" DROP COLUMN "contractor_id";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "contractor_id";--> statement-breakpoint
DROP TABLE "contractors";
