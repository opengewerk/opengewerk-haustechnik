-- Rolling the contracts and the warranty back to how 0059 left the database.
--
-- What it costs an installation that runs it: every contract with what it
-- covers, the contract a duty named, the documents of a contract with their
-- versions, the deadlines of the contracts and of the warranties, the
-- warranty of an accepted work order, and the two rights "Verträge ansehen"
-- and "Verträge führen" in the rows of the roles. The warranty of an asset
-- stays, it is older than this.

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove(array_remove("rights", 'contract.read'), 'contract.write'),
       "updated_at" = now()
 WHERE 'contract.read' = ANY ("rights") OR 'contract.write' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "deadlines"
 WHERE "contract_id" IS NOT NULL OR "warranty_asset_id" IS NOT NULL OR "warranty_order_id" IS NOT NULL
    OR "attachment_id" IN (SELECT "id" FROM "attachments" WHERE "contract_id" IS NOT NULL);--> statement-breakpoint
DELETE FROM "attachment_versions"
 WHERE "attachment_id" IN (SELECT "id" FROM "attachments" WHERE "contract_id" IS NOT NULL);--> statement-breakpoint
DELETE FROM "attachments" WHERE "contract_id" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_place_or_a_contractor";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_contract_with_its_contractor";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_on_a_contract_of_their_contractor";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_contract";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_asset";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_an_asset_of_their_property";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_their_work_order";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_a_work_order_of_their_property";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_of_a_contract";--> statement-breakpoint
DROP INDEX "duties_contract_idx";--> statement-breakpoint
DROP INDEX "deadlines_contract_idx";--> statement-breakpoint
DROP INDEX "deadlines_warranty_asset_idx";--> statement-breakpoint
DROP INDEX "deadlines_warranty_order_idx";--> statement-breakpoint
DROP INDEX "attachments_contract_idx";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN "contract_id";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "warranty_ends_on";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "contract_id";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "warranty_asset_id";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "warranty_order_id";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "contract_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id") = 1);--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_place_or_a_contractor" CHECK (("attachments"."contractor_id" is null) = ("attachments"."property_id" is not null) and ("attachments"."area_id" is null) = ("attachments"."property_id" is null));--> statement-breakpoint
DROP TABLE "contract_items";--> statement-breakpoint
DROP TABLE "contracts";--> statement-breakpoint
DROP FUNCTION "mark_below_a_contract"();
