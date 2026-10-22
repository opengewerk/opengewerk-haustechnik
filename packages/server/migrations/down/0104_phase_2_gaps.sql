-- Takes back 0104_phase_2_gaps: the confirmation of an address, the record of a
-- print of a round, the limits of the places of an auditor as they were, and
-- the qualifications for every reader of them. A print made of a later record
-- of a round cannot stay; while there is one, this does not run.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "prints" WHERE "activity_id" IS NOT NULL
	           GROUP BY "tenant_id", "activity_id" HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'Ein Rundgang hat schon ein zweites PDF; 0104 lässt sich nicht zurücknehmen.';
	END IF;
END;
$$;--> statement-breakpoint
DROP FUNCTION "contact_to_confirm"(text);--> statement-breakpoint
DROP POLICY "readable_by_the_owner" ON "fault_report_contacts";--> statement-breakpoint
DROP POLICY "of_people_in_sight" ON "qualifications";--> statement-breakpoint
DROP FUNCTION "person_in_sight"(text);--> statement-breakpoint
ALTER POLICY "within_limits" ON "buildings" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "buildings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "buildings"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
ALTER POLICY "within_limits" ON "floors" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "floors"."property_id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "floors"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
ALTER POLICY "within_limits" ON "properties" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "properties"."id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "properties"."id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
ALTER POLICY "within_limits" ON "rooms" TO opengewerk_app USING (((SELECT session_limit_properties()) IS NULL OR "rooms"."property_id" = ANY ((SELECT session_limit_properties())::uuid[]))) WITH CHECK (((SELECT session_limit_properties()) IS NULL OR "rooms"."property_id" = ANY ((SELECT session_limit_properties())::uuid[])));--> statement-breakpoint
ALTER TABLE "fault_report_contacts" DROP CONSTRAINT "fault_report_contacts_confirmed_after_mail";--> statement-breakpoint
ALTER TABLE "fault_report_contacts" DROP CONSTRAINT "fault_report_contacts_confirmation_shaped";--> statement-breakpoint
DROP INDEX "fault_report_contacts_confirmation_once";--> statement-breakpoint
ALTER TABLE "fault_report_contacts" DROP COLUMN "confirmed_at";--> statement-breakpoint
ALTER TABLE "fault_report_contacts" DROP COLUMN "confirmation_mailed_at";--> statement-breakpoint
ALTER TABLE "fault_report_contacts" DROP COLUMN "confirmation_sha256";--> statement-breakpoint
DROP INDEX "prints_of_a_round_once";--> statement-breakpoint
DROP INDEX "prints_of_a_round_record_once";--> statement-breakpoint
ALTER TABLE "prints" DROP CONSTRAINT "prints_of_a_round_record";--> statement-breakpoint
ALTER TABLE "round_records" DROP CONSTRAINT "round_records_place";--> statement-breakpoint
ALTER TABLE "prints" DROP COLUMN "round_record_id";--> statement-breakpoint
CREATE UNIQUE INDEX "prints_of_a_round_once" ON "prints" USING btree ("tenant_id","activity_id");
