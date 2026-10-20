-- A board stands in a building, and in a room where that is known (#495).
--
-- Until now a board knew only its asset, and so it stood wherever the
-- low-voltage installation stood: a sub-board in a building the installation
-- supplies could be taken down only in the file of the installation, and the
-- building did not show it. Every board that is there stands from here on in
-- the building of its asset, without a room; nothing is lost and nothing
-- moves. Its area stays the one of the asset.
--
-- The building is the one of the asset or one the asset supplies, by itself
-- or through a room in it, which no key can say: a trigger holds it, when a
-- board is made, moved or put on another asset. A board that stood in the
-- building of its asset follows the asset when the asset moves to another
-- building, unless the asset still supplies the building of before.
--
-- The key onto `buildings` and `rooms` is checked against the rows the
-- policies of the owner show, and the migration sets no tenant: the tables
-- go without FORCE for the statements that fill and check the column, as
-- 0051 and 0096 do (#315).
ALTER TABLE "distribution_boards" ADD COLUMN "building_id" uuid;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "distribution_boards" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buildings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rooms" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "distribution_boards" AS "board" SET "building_id" = "asset"."building_id"
	FROM "assets" AS "asset"
	WHERE "asset"."tenant_id" = "board"."tenant_id" AND "asset"."id" = "board"."asset_id";--> statement-breakpoint
ALTER TABLE "distribution_boards" ALTER COLUMN "building_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_in_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_boards" ADD CONSTRAINT "distribution_boards_in_a_room_of_their_building" FOREIGN KEY ("tenant_id","room_id","building_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","building_id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "distribution_boards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "distribution_boards_building_idx" ON "distribution_boards" USING btree ("tenant_id","building_id");--> statement-breakpoint

-- The buildings a board of an asset may stand in: the one of the asset, and
-- every building it supplies, by itself or through a room. As the person
-- asks, under the policies: a building or a supply the person does not see is
-- none here, and the key refuses a building the person does not see anyway.
CREATE FUNCTION "board_buildings_of"(p_tenant uuid, p_asset uuid) RETURNS SETOF uuid
	LANGUAGE sql STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT a.building_id FROM public.assets a WHERE a.tenant_id = p_tenant AND a.id = p_asset
	UNION
	SELECT coalesce(s.building_id, r.building_id)
	  FROM public.asset_supplies s
	  LEFT JOIN public.rooms r ON r.tenant_id = s.tenant_id AND r.id = s.room_id
	 WHERE s.tenant_id = p_tenant AND s.asset_id = p_asset AND s.deleted_at IS NULL
	   AND coalesce(s.building_id, r.building_id) IS NOT NULL
$$;--> statement-breakpoint

-- A board made without a building, by a device of before or anybody who
-- does not name one, stands where its asset stands, as every board did
-- until now.
CREATE FUNCTION "boards_in_a_building_of_their_installation"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF new.building_id IS NULL THEN
		SELECT a.building_id INTO new.building_id
		  FROM public.assets a WHERE a.tenant_id = new.tenant_id AND a.id = new.asset_id;
		new.room_id := NULL;
	END IF;

	-- An asset the person does not see is not asked here: the key onto it and
	-- the policies refuse that row, as for the trigger of the installation.
	IF EXISTS (SELECT 1 FROM public.assets a WHERE a.tenant_id = new.tenant_id AND a.id = new.asset_id)
	   AND NOT EXISTS (SELECT 1 FROM public.board_buildings_of(new.tenant_id, new.asset_id) AS b(id)
	                    WHERE b.id = new.building_id) THEN
		RAISE EXCEPTION 'Ein Verteiler steht im Gebäude seiner Niederspannungsanlage oder in einem, das sie versorgt.'
			USING ERRCODE = 'HT016';
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "in_a_building_of_their_installation" BEFORE INSERT OR UPDATE OF "asset_id", "building_id" ON "distribution_boards"
	FOR EACH ROW EXECUTE FUNCTION "boards_in_a_building_of_their_installation"();--> statement-breakpoint

-- A board in the building of its asset follows the asset to another
-- building, without its room, unless the asset still supplies the building of
-- before: then the board stands in a building the asset supplies.
CREATE FUNCTION "boards_follow_their_installation"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM public.board_buildings_of(new.tenant_id, new.id) AS b(id)
	                WHERE b.id = old.building_id) THEN
		UPDATE public.distribution_boards
		   SET building_id = new.building_id, room_id = NULL
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND building_id = old.building_id;
	END IF;

	RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "boards_follow_their_installation" AFTER UPDATE OF "building_id" ON "assets"
	FOR EACH ROW WHEN (new.building_id IS DISTINCT FROM old.building_id)
	EXECUTE FUNCTION "boards_follow_their_installation"();
