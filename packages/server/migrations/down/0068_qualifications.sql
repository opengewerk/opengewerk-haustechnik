-- Takes back 0068_qualifications: the rights, the key and column on the
-- deadlines, and the two tables of the qualifications.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" SET "rights" = array_remove(array_remove("rights", 'qualification.read'), 'qualification.write'), "updated_at" = now()
 WHERE 'qualification.read' = ANY ("rights") OR 'qualification.write' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_qualification";--> statement-breakpoint
DROP INDEX "deadlines_qualification_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "qualification_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null or "deadlines"."delegation_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null) and ("deadlines"."delegation_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id") = 1);--> statement-breakpoint
DROP TABLE "qualifications";--> statement-breakpoint
DROP TABLE "qualification_kinds";
