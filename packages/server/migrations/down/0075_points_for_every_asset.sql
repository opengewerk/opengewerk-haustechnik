-- Takes back 0075_points_for_every_asset: the trigger, the asset of an answer
-- with its key and index, and the assets of the points of a round. An answer
-- about an asset has no place in the index before it and would make two
-- answers to one point; it goes with the column.

DROP TRIGGER "answers_about_the_assets_of_their_point" ON "activity_answers";--> statement-breakpoint
DROP FUNCTION "answers_about_the_assets_of_their_point"();--> statement-breakpoint
ALTER TABLE "activity_answers" DROP CONSTRAINT "activity_answers_asset_outside_a_group";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_point_assets_of_a_round";--> statement-breakpoint
DROP INDEX "activity_answers_once";--> statement-breakpoint
ALTER TABLE "activity_answers" DROP CONSTRAINT "activity_answers_about_an_asset_of_their_property";--> statement-breakpoint
DELETE FROM "activity_answers" WHERE "asset_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_answers" DROP COLUMN "asset_id";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "point_assets";--> statement-breakpoint
CREATE UNIQUE INDEX "activity_answers_once" ON "activity_answers" USING btree ("tenant_id","activity_id",coalesce("group_key", ''),coalesce("block_key", ''),"field_key") WHERE "activity_answers"."deleted_at" is null;
