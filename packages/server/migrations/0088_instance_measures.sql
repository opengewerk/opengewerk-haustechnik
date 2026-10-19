-- Part B of the technical and organisational measures and the subprocessors
-- of the instance (#358, decided on 19.10.2026): what whoever runs the
-- instance ensures while running it, and who works for them doing so,
-- annexes 1 and 2 of the contract on processing on behalf. The same change as
-- migration 0079 of the trades application, from the same building block,
-- which came with the submodule that brings the photo from the gallery
-- (opengewerk/opengewerk#671 and #673 sit after #672 on its main).
--
-- Kept in the area of the instance and read into the documents of an
-- operator; the screen and the documents come with #358. A version of the
-- application from before this migration runs on unchanged: it neither reads
-- nor writes the columns, and the one row of settings takes the defaults, an
-- empty part B and no subprocessor.

ALTER TABLE "instance_settings" ADD COLUMN "measures" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "subprocessors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_measures_object" CHECK (jsonb_typeof("instance_settings"."measures") = 'object');--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_subprocessors_list" CHECK (jsonb_typeof("instance_settings"."subprocessors") = 'array');