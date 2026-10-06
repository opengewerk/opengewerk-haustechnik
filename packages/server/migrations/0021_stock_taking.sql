-- Taking stock on site (#99, sections 2.7 and 4.2 of the concept).
--
-- An asset says what it was held against when it was entered and found to be
-- another, so that a possible duplicate somebody has seen is not asked about
-- a second time. No key stands behind the ids: one of them may be removed
-- later, and what was said about it then stays true.
ALTER TABLE "assets" ADD COLUMN "distinct_from" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "assets" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
-- The assets of the tenant of the transaction that may be the one somebody
-- enters, past the areas (ADR 0003, addendum on #99): two people who take
-- stock in two areas enter the same asset as easily as two in one, and the
-- policy of the areas hides the first from the second.
--
-- What a duplicate is, `domain` says, on a device and on the server alike,
-- and it is not said a second time here. This hands over only the assets
-- whose digits fit what is asked: lowering a text and taking the spaces out
-- of it changes no digit, so every asset the rule of `domain` would name is
-- among them, and whoever asks has to know the number almost to the letter.
-- The tenant is read from the transaction and is no argument.
CREATE FUNCTION "asset_duplicate_candidates"("asked_serial" text, "asked_mark" text)
	RETURNS TABLE ("id" uuid, "serial_number" text, "mark" text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT a.id, a.serial_number, a.mark
	  FROM public.assets a
	 WHERE a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	   AND a.deleted_at IS NULL
	   AND ((asked_serial IS NOT NULL AND a.serial_number IS NOT NULL
	         AND regexp_replace(a.serial_number, '[^0-9]', '', 'g') = regexp_replace(asked_serial, '[^0-9]', '', 'g'))
	     OR (asked_mark IS NOT NULL AND a.mark IS NOT NULL
	         AND regexp_replace(a.mark, '[^0-9]', '', 'g') = regexp_replace(asked_mark, '[^0-9]', '', 'g')))
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "asset_duplicate_candidates"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "asset_duplicate_candidates"(text, text) TO "opengewerk_app";--> statement-breakpoint
-- A label from a sheet is given to an asset on site, by the application, once
-- and for good. One that hangs on an asset or a room stays there: a sticker
-- is on one thing, and a row that moved would open the wrong page for whoever
-- scans the first. One that is blocked or gone is given to nothing.
CREATE FUNCTION "keep_label_given"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.asset_id IS NOT NULL OR old.room_id IS NOT NULL THEN
		RAISE EXCEPTION 'Ein Etikett bleibt, woran es hängt.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF old.blocked_at IS NOT NULL OR old.deleted_at IS NOT NULL THEN
		RAISE EXCEPTION 'Ein gesperrtes Etikett wird nicht mehr zugeordnet.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "labels_given_stays" BEFORE UPDATE OF "asset_id", "room_id" ON "labels"
	FOR EACH ROW
	WHEN (new.asset_id IS DISTINCT FROM old.asset_id OR new.room_id IS DISTINCT FROM old.room_id)
	EXECUTE FUNCTION "keep_label_given"();--> statement-breakpoint
GRANT UPDATE ("asset_id") ON "labels" TO "opengewerk_app";
