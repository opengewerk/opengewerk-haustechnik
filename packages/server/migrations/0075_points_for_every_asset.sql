-- A point of a template for every asset of a kind (#343, section 4.5 of the
-- concept): a round asks it once for each asset it was given when it was
-- made, each with an answer of its own.
--
-- - `point_assets` holds those assets by the key of the point, written by the
--   server when it makes a round, and only on a round with a form.
-- - `asset_id` names the asset an answer to such a point is about: one on the
--   property of the answer, as the key says, and one the round was given for
--   that point, as the trigger `answers_about_the_assets_of_their_point` says.
--   An answer to any other point names none. The point is answered once for
--   each of its assets, which the unique index takes the asset into.

DROP INDEX "activity_answers_once";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "point_assets" jsonb;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
-- A key onto a table with rows is checked past the policies of the owner,
-- who migrates (#315): under FORCE it would see only what they show.
ALTER TABLE "activity_answers" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_about_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_answers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_answers_once" ON "activity_answers" USING btree ("tenant_id","activity_id",coalesce("group_key", ''),coalesce("block_key", ''),"field_key",coalesce("asset_id"::text, '')) WHERE "activity_answers"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_point_assets_of_a_round" CHECK ("activities"."point_assets" is null or ("activities"."kind" = 'round' and "activities"."form_key" is not null and jsonb_typeof("activities"."point_assets") = 'object'));--> statement-breakpoint
ALTER TABLE "activity_answers" ADD CONSTRAINT "activity_answers_asset_outside_a_group" CHECK ("activity_answers"."asset_id" is null or "activity_answers"."group_key" is null);--> statement-breakpoint

-- An answer to a point the round holds assets for names one of them, and an
-- answer to any other point none.
CREATE FUNCTION "answers_about_the_assets_of_their_point"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
DECLARE
	given jsonb;
BEGIN
	SELECT a.point_assets -> new.field_key INTO given
	  FROM public.activities a
	 WHERE a.id = new.activity_id;

	IF new.group_key IS NULL AND given IS NOT NULL THEN
		IF new.asset_id IS NULL OR jsonb_typeof(given) <> 'array' OR NOT given @> jsonb_build_array(new.asset_id::text) THEN
			RAISE EXCEPTION 'Nach dieser Anlage fragt der Punkt in diesem Rundgang nicht.' USING ERRCODE = 'HT012';
		END IF;
	ELSIF new.asset_id IS NOT NULL THEN
		RAISE EXCEPTION 'Dieser Punkt fragt nach keiner Anlage.' USING ERRCODE = 'HT012';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "answers_about_the_assets_of_their_point" BEFORE INSERT OR UPDATE ON "activity_answers"
	FOR EACH ROW EXECUTE FUNCTION "answers_about_the_assets_of_their_point"();
