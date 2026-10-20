-- Back to how 0099 left things: a board knows only its asset again, and
-- neither its building nor its room stays.
--
-- Run as the superuser, like every rollback.
DROP TRIGGER IF EXISTS "boards_follow_their_installation" ON "assets";--> statement-breakpoint
DROP FUNCTION IF EXISTS "boards_follow_their_installation"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "in_a_building_of_their_installation" ON "distribution_boards";--> statement-breakpoint
DROP FUNCTION IF EXISTS "boards_in_a_building_of_their_installation"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "board_buildings_of"(uuid, uuid);--> statement-breakpoint
DROP INDEX IF EXISTS "distribution_boards_building_idx";--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP CONSTRAINT IF EXISTS "distribution_boards_in_a_room_of_their_building";--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP CONSTRAINT IF EXISTS "distribution_boards_in_a_building_of_their_property";--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP COLUMN IF EXISTS "room_id";--> statement-breakpoint
ALTER TABLE "distribution_boards" DROP COLUMN IF EXISTS "building_id";
