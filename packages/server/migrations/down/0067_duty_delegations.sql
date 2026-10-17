-- Takes back 0067_duty_delegations: the right, the keys and columns on the
-- duties and the deadlines, and the four tables of the delegations.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_remove("rights", 'duty.delegate'), "updated_at" = now()
 WHERE 'duty.delegate' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_delegation";--> statement-breakpoint
DROP INDEX "deadlines_delegation_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "delegation_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id") = 1);--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_delegation_names_a_person";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_responsible_from_their_delegation";--> statement-breakpoint
DROP INDEX "duties_delegation_idx";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "responsible_delegation_id";--> statement-breakpoint
DROP TABLE "duty_delegation_revocations";--> statement-breakpoint
DROP TABLE "duty_delegation_signatures";--> statement-breakpoint
DROP TABLE "duty_delegation_areas";--> statement-breakpoint
DROP TABLE "duty_delegations";--> statement-breakpoint
DROP FUNCTION "delegation_kept_as_written"();--> statement-breakpoint
DROP FUNCTION "delegation_kept_as_signed"();--> statement-breakpoint
DROP TYPE "public"."delegation_scope";--> statement-breakpoint
DROP TYPE "public"."delegation_role";
