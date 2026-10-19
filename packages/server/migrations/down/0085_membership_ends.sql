-- Takes back 0085_membership_ends: the deadlines of an access with their
-- column, key and checks as before, and the two tables. A removal already made
-- stays made: the devices, passkeys and addresses it took do not come back.
DELETE FROM "deadlines" WHERE "member_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_of_an_access";--> statement-breakpoint
DROP INDEX "deadlines_member_idx";--> statement-breakpoint
ALTER TABLE "deadlines" DROP COLUMN "member_user_id";--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null or "deadlines"."delegation_id" is not null or "deadlines"."qualification_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null) and ("deadlines"."delegation_id" is null or "deadlines"."property_id" is null) and ("deadlines"."qualification_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id", "deadlines"."delegation_id", "deadlines"."qualification_id", "deadlines"."evidence_id") = 1);--> statement-breakpoint
DROP TABLE "membership_removals";--> statement-breakpoint
DROP TABLE "membership_settings";
