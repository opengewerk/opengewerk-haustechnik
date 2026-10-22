-- A duty from the catalogue that takes the place of a duty of the operator's
-- own at the same asset (section 4.3 of the concept, #514): the own duty ends
-- when the proposal is confirmed, and its last evidence counts for the due day
-- of the new one. The key runs over the property and the asset, so the two stand
-- at one asset.
ALTER TABLE "duties" ADD COLUMN "replaces_duty_id" uuid;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_asset_key" UNIQUE("tenant_id","id","property_id","asset_id");--> statement-breakpoint
-- An instance migrates as the owner, and under FORCE a key is checked only
-- against what the policies show (#315).
ALTER TABLE "duties" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_replace_one_at_their_asset" FOREIGN KEY ("tenant_id","replaces_duty_id","property_id","asset_id") REFERENCES "public"."duties"("tenant_id","id","property_id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "duties_replaced_once" ON "duties" USING btree ("tenant_id","replaces_duty_id") WHERE "duties"."replaces_duty_id" is not null;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_replaced_by_the_catalogue" CHECK ("duties"."replaces_duty_id" is null or ("duties"."kind" is not null and "duties"."replaces_duty_id" <> "duties"."id"));
