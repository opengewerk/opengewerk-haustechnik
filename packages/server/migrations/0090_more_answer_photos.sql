-- The photos of a point after the first (#451, Moritz on 19.10.2026: "Man
-- muss auch mehrere Fotos hinzufügen können").
--
-- `more_attachment_ids`: in the order they were added, beside the first in
-- `attachment_id`, which stays what it was. An answer from before has an
-- empty list, so the page that was signed for it stays the same and its
-- signature counts.
--
-- A list has no key behind each entry. What the key
-- `activity_answers_photo_at_their_activity` holds for the first, the trigger
-- `answers_more_photos_at_their_activity` holds for the others: each a
-- document at the activity of the answer, on its property, and none twice.
-- The check holds that there are more only beside a first, twenty with it at
-- most. The lock `answers_kept_once_signed` covers the new column as every
-- other: it refuses any change to an answer once its activity is signed.
ALTER TABLE "activity_answers" ADD COLUMN "more_attachment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_more_photos_beside_the_first" CHECK (cardinality("activity_answers"."more_attachment_ids") = 0 or ("activity_answers"."attachment_id" is not null and cardinality("activity_answers"."more_attachment_ids") < 20));--> statement-breakpoint

-- Read as whoever writes the answer: the documents of an activity lie in its
-- area, as its answers do, so the person who may write the one sees the other.
CREATE FUNCTION "answers_more_photos_at_their_activity"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF cardinality(new.more_attachment_ids) = 0 THEN
		RETURN new;
	END IF;

	IF new.attachment_id = ANY (new.more_attachment_ids)
		OR (SELECT count(DISTINCT photo) FROM unnest(new.more_attachment_ids) AS photo)
			<> cardinality(new.more_attachment_ids) THEN
		RAISE EXCEPTION 'Ein Foto steht nur einmal an einem Punkt.' USING ERRCODE = 'HT013';
	END IF;

	IF EXISTS (
		SELECT 1
		  FROM unnest(new.more_attachment_ids) AS photo
		 WHERE NOT EXISTS (
			SELECT 1
			  FROM public.attachments AS document
			 WHERE document.tenant_id = new.tenant_id
			   AND document.id = photo
			   AND document.property_id = new.property_id
			   AND document.activity_id = new.activity_id
		)
	) THEN
		RAISE EXCEPTION 'Ein Foto eines Punkts ist ein Dokument seines Vorgangs.' USING ERRCODE = 'HT013';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "answers_more_photos_at_their_activity"
	BEFORE INSERT OR UPDATE OF "more_attachment_ids", "attachment_id" ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "answers_more_photos_at_their_activity"();
