-- Rolling the contacts and documents of contractors back to how 0058 left
-- the database.
--
-- What it costs an installation that runs it: every contact and every
-- document of a contractor with its versions, and the deadlines of those
-- documents. Versions refuse a removal, so their trigger steps aside while
-- they leave, and comes back afterwards. The bytes stay in the store.

DROP TRIGGER "contacts_and_documents_follow_deletion" ON "contractors";--> statement-breakpoint
DROP FUNCTION "mark_below_a_contractor"();--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_versions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_versions" DISABLE TRIGGER "attachment_versions_stay_as_written";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "deadlines" WHERE "property_id" IS NULL;--> statement-breakpoint
DELETE FROM "contacts" WHERE "contractor_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "attachment_versions" WHERE "attachment_id" IN (SELECT "id" FROM "attachments" WHERE "contractor_id" IS NOT NULL);--> statement-breakpoint
DELETE FROM "attachments" WHERE "contractor_id" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "attachment_versions" ENABLE TRIGGER "attachment_versions_stay_as_written";--> statement-breakpoint
ALTER TABLE "attachment_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER POLICY "within_areas_or_a_building" ON "contacts" TO opengewerk_app USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]) OR EXISTS (SELECT 1 FROM buildings WHERE buildings.tenant_id = contacts.tenant_id AND buildings.property_id = contacts.property_id AND buildings.deleted_at IS NULL));--> statement-breakpoint
ALTER POLICY "within_areas_insert" ON "contacts" TO opengewerk_app WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas_update" ON "contacts" TO opengewerk_app USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas_delete" ON "contacts" TO opengewerk_app USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas" ON "deadlines" TO opengewerk_app USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas" ON "attachments" TO opengewerk_app USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_at_a_property_or_a_contractor";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_place_or_a_contractor";--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_of_a_contractor";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_of_a_contractor";--> statement-breakpoint
DROP INDEX "contacts_contractor_idx";--> statement-breakpoint
DROP INDEX "attachments_contractor_idx";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "contractor_id";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "contractor_id";--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "area_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ALTER COLUMN "area_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "property_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "area_id" SET NOT NULL;
