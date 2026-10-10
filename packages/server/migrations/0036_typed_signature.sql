-- The other way to sign (#209, section 2.6 of the concept): "mit dem
-- Schriftzug auf dem Gerät oder, wo das eine Hürde ist, ohne ihn: die Person
-- bestätigt mit ihrem getippten Namen." A signature holds the drawing or the
-- typed name, one of the two. Every signature written before holds its
-- drawing, so the checks hold for them at once; nothing changes a row.

ALTER TABLE "activity_signatures" ALTER COLUMN "path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD COLUMN "typed_name" text;--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_one_way" CHECK (num_nonnulls("activity_signatures"."path", "activity_signatures"."typed_name") = 1);--> statement-breakpoint
ALTER TABLE "activity_signatures" ADD CONSTRAINT "activity_signatures_typed_name_shaped" CHECK ("activity_signatures"."typed_name" is null or ("activity_signatures"."typed_name" = btrim("activity_signatures"."typed_name") and char_length("activity_signatures"."typed_name") between 1 and 200));
