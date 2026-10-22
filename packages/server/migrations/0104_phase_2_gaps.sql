-- Gaps the review of phase 2 found (22.10.2026), as the database holds them.
--
-- - S9: the qualifications of a person only for whoever sees an area that
--   person works in, every one for whoever sees every area and for the runs
--   (section 7 of the concept: a right holds in the areas of the person).
--   `person_in_sight(user_id)` reads the areas of both; the policy
--   `of_people_in_sight` holds it for reading and writing.
-- - S10: an auditor from outside limited to kinds of assets sees of the
--   places only those on the way to an asset of the kinds (section 7: "sieht
--   nichts, was an keiner Anlage hängt").
-- - #518: a print of a round names the handing in it was made of, so that a
--   round opened again (#510) is printed anew; one made before stays the
--   print of the first record of its round.
-- - S12: the address for an answer to a report without an account is
--   confirmed over a link before an answer names the building and the room.
--   Of the link only its hash is kept; `contact_to_confirm(hash)` is the one
--   way past the operators to it, as `label_open_to_reports` is to a label,
--   with `readable_by_the_owner` on the addresses for it.
--
-- **Fits the version before it.** It reads none of the new columns: a print
-- it makes of a round leaves the record empty, which the partial index takes
-- as before, and it answers an address as before.

DROP INDEX "prints_of_a_round_once";--> statement-breakpoint
ALTER TABLE "prints" ADD COLUMN "round_record_id" uuid;--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD COLUMN "confirmation_sha256" text;--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD COLUMN "confirmation_mailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_records" ADD CONSTRAINT "round_records_place" UNIQUE("tenant_id","id","property_id");--> statement-breakpoint
-- A key onto a table with rows: checked as the owner, which FORCE would hold to
-- the policies (#315).
ALTER TABLE "prints" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "round_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_of_a_round_record" FOREIGN KEY ("tenant_id","round_record_id","property_id") REFERENCES "public"."round_records"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "round_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "prints_of_a_round_record_once" ON "prints" USING btree ("tenant_id","round_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fault_report_contacts_confirmation_once" ON "fault_report_contacts" USING btree ("confirmation_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "prints_of_a_round_once" ON "prints" USING btree ("tenant_id","activity_id") WHERE "prints"."round_record_id" is null;--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD CONSTRAINT "fault_report_contacts_confirmation_shaped" CHECK ("fault_report_contacts"."confirmation_sha256" is null or "fault_report_contacts"."confirmation_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "fault_report_contacts" ADD CONSTRAINT "fault_report_contacts_confirmed_after_mail" CHECK (("fault_report_contacts"."confirmation_sha256" is null) = ("fault_report_contacts"."confirmation_mailed_at" is null) and ("fault_report_contacts"."confirmed_at" is null or "fault_report_contacts"."confirmation_mailed_at" is not null));--> statement-breakpoint
CREATE FUNCTION "person_in_sight"("asked" text) RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT session_sees_all_areas()
	    OR asked = nullif(current_setting('app.user_id', true), '')
	    OR EXISTS (
	         SELECT 1
	           FROM public.member_all_areas a
	          WHERE a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	            AND a.user_id = asked)
	    OR EXISTS (
	         SELECT 1
	           FROM public.member_areas ma
	          WHERE ma.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	            AND ma.user_id = asked
	            AND ma.area_id = ANY ((SELECT session_areas())::uuid[]))
$$;--> statement-breakpoint
CREATE POLICY "of_people_in_sight" ON "qualifications" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (public.person_in_sight("qualifications"."user_id")) WITH CHECK (public.person_in_sight("qualifications"."user_id"));--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "fault_report_contacts" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
ALTER POLICY "within_limits" ON "buildings" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "buildings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.building_id = "buildings"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "buildings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.building_id = "buildings"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))));--> statement-breakpoint
ALTER POLICY "within_limits" ON "floors" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "floors"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.rooms r JOIN public.assets a ON a.tenant_id = r.tenant_id AND a.room_id = r.id WHERE r.floor_id = "floors"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "floors"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.rooms r JOIN public.assets a ON a.tenant_id = r.tenant_id AND a.room_id = r.id WHERE r.floor_id = "floors"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))));--> statement-breakpoint
ALTER POLICY "within_limits" ON "properties" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "properties"."id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.property_id = "properties"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "properties"."id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.property_id = "properties"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))));--> statement-breakpoint
ALTER POLICY "within_limits" ON "rooms" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "rooms"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.room_id = "rooms"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[])))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "rooms"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])) AND ((SELECT session_limit_asset_kinds()) IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.room_id = "rooms"."id" AND a.kind = ANY ((SELECT session_limit_asset_kinds())::text[]))));--> statement-breakpoint

CREATE FUNCTION "contact_to_confirm"("asked" text) RETURNS TABLE("tenant_id" uuid, "area_id" uuid)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT c.tenant_id, c.area_id
	  FROM public.fault_report_contacts c
	 WHERE c.confirmation_sha256 = asked
	   AND c.confirmed_at IS NULL
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "contact_to_confirm"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "contact_to_confirm"(text) TO "opengewerk_app";
