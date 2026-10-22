-- The signature under a briefing names the page the person saw (#545), as the
-- client's signature under a service report does: a fingerprint of 64
-- hexadecimal digits. A briefing from before has none and keeps none; one the
-- application writes from now on has one, and the database holds both.
ALTER TABLE "briefings" ADD COLUMN "page_fingerprint" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_page_fingerprint_shaped" CHECK ("briefings"."page_fingerprint" is null or "briefings"."page_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
CREATE FUNCTION "briefing_names_its_page"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.page_fingerprint IS NULL AND current_user = 'opengewerk_app' THEN
		RAISE EXCEPTION 'Eine Einweisung nennt die Seite, die die Person gesehen und unterschrieben hat.'
			USING ERRCODE = 'HT018';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "briefings_name_their_page" BEFORE INSERT ON "briefings"
	FOR EACH ROW EXECUTE FUNCTION "briefing_names_its_page"();
