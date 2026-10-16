-- The people to talk to and the documents of a contractor (#328, second
-- part; section 4.11 of the concept).
--
-- A contractor lies in no area (2.8), and so do what hangs on it: decided by
-- Moritz on 16.10.2026, ADR 0003, addendum of #328. In `contacts`,
-- `attachments` and `deadlines` a row may now be without a property and
-- without an area, exactly when it hangs on something of the whole operator:
--
-- `contacts`: `contractor_id`, a key with the tenant onto the firm, and the
-- check that a contact hangs on a property or on a contractor, exactly one,
-- with an area exactly when it has a property.
--
-- `attachments`: `contractor_id` the same way; a document of a contractor
-- names no property and nothing on one, and has no area. Its versions follow
-- their document by the policy they have.
--
-- `deadlines`: the deadline of such a document has no property and no area;
-- the check allows that only for the deadline of a document.
--
-- The restrictive policies let a row without an area through for whoever is
-- in the operator, with the expression `area_id IS NULL OR ...`. Every other
-- row stays behind the line between the areas, and which person may read a
-- firm's contacts and documents at all, the right of the route says.
--
-- A firm that is marked takes its contacts and documents along, by a trigger
-- like the one of a property; the deadline of a removed document drops with
-- the next pass, as for every other document.
--
-- The keys onto the firm are laid while none of the tables is under FORCE, as
-- 0057 does it (#315).

ALTER TABLE "contacts" ALTER COLUMN "property_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "area_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ALTER COLUMN "property_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ALTER COLUMN "area_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "property_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "area_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "contractor_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "contractor_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractors" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_of_a_contractor" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_of_a_contractor" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "contacts_contractor_idx" ON "contacts" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
CREATE INDEX "attachments_contractor_idx" ON "attachments" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_at_a_property_or_a_contractor" CHECK (num_nonnulls("contacts"."property_id", "contacts"."contractor_id") = 1 and ("contacts"."area_id" is null) = ("contacts"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_place_or_a_contractor" CHECK (("attachments"."contractor_id" is null) = ("attachments"."property_id" is not null) and ("attachments"."area_id" is null) = ("attachments"."property_id" is null));--> statement-breakpoint
ALTER POLICY "within_areas_or_a_building" ON "contacts" TO opengewerk_app USING (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]) OR EXISTS (SELECT 1 FROM buildings WHERE buildings.tenant_id = contacts.tenant_id AND buildings.property_id = contacts.property_id AND buildings.deleted_at IS NULL));--> statement-breakpoint
ALTER POLICY "within_areas_insert" ON "contacts" TO opengewerk_app WITH CHECK (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas_update" ON "contacts" TO opengewerk_app USING (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas_delete" ON "contacts" TO opengewerk_app USING (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas" ON "deadlines" TO opengewerk_app USING (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER POLICY "within_areas" ON "attachments" TO opengewerk_app USING (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK (area_id IS NULL OR (SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
-- Not SECURITY DEFINER, for the reason of `mark_contacts_below`: what hangs
-- on a firm lies in no area, so whoever may mark the firm sees it. The
-- statements name the tenant.
CREATE FUNCTION "mark_below_a_contractor"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	UPDATE public.contacts SET deleted_at = new.deleted_at
	 WHERE tenant_id = new.tenant_id AND contractor_id = new.id AND deleted_at IS NULL;
	UPDATE public.attachments SET deleted_at = new.deleted_at
	 WHERE tenant_id = new.tenant_id AND contractor_id = new.id AND deleted_at IS NULL;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contacts_and_documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "contractors"
	FOR EACH ROW EXECUTE FUNCTION "mark_below_a_contractor"();
