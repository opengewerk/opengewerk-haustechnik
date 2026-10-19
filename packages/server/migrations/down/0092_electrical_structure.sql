-- Takes the electrical structure below a low-voltage installation out again,
-- back to how 0091 left things. Run as the superuser, like every rollback.
--
-- What it costs an installation that runs it: every board with its sections,
-- circuits and equipment, which no circuit chart can print any more. What the
-- log of changes said about them it keeps.
DROP TRIGGER IF EXISTS "boards_keep_their_installation" ON "assets";--> statement-breakpoint
DROP TRIGGER IF EXISTS "structure_follows_deletion" ON "assets";--> statement-breakpoint
DROP TABLE IF EXISTS "equipment";--> statement-breakpoint
DROP TABLE IF EXISTS "circuits";--> statement-breakpoint
DROP TABLE IF EXISTS "board_sections";--> statement-breakpoint
DROP TABLE IF EXISTS "distribution_boards";--> statement-breakpoint
DROP FUNCTION IF EXISTS "boards_on_a_low_voltage_installation"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "mark_structure_below"();--> statement-breakpoint
DROP TYPE IF EXISTS "public"."cable_installation_method";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."distribution_board_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."overcurrent_device";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."rcd_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."trip_characteristic";
