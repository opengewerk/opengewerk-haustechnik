-- Takes the photos of a point after the first out again, back to how 0089
-- left things. Run as the superuser, like every rollback.
--
-- What it costs an installation that runs it: every photo of a point but the
-- first stays a document of its activity, and no answer names it any more.
-- A page signed with more than one photo at a point no longer matches its
-- signature; the evidence written for it keeps every photo.
DROP TRIGGER IF EXISTS "answers_more_photos_at_their_activity" ON "activity_answers";--> statement-breakpoint
DROP FUNCTION IF EXISTS "answers_more_photos_at_their_activity"();--> statement-breakpoint
ALTER TABLE "activity_answers" DROP CONSTRAINT IF EXISTS "activity_answers_more_photos_beside_the_first";--> statement-breakpoint
ALTER TABLE "activity_answers" DROP COLUMN IF EXISTS "more_attachment_ids";
