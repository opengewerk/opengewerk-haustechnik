-- The people to talk to at a property (section 4.1 of the concept,
-- opengewerk-haustechnik#85): the contacts of the foundation (ADR 0010 of the
-- repository opengewerk), with what a contact hangs on here.
--
-- Who a contact is and how to reach them are the columns of the foundation: a
-- given name, a family name no contact does without, what somebody is there,
-- a phone number and an e-mail address, and the columns of the sync. What a
-- contact hangs on is this application's: its property, and nothing else, so
-- the column cannot be empty and is the whole of "exactly one parent". The
-- texts are kept the way a route hands them over, trimmed and bounded.
--
-- Every row carries the area of its property, kept by the key over
-- (tenant_id, property_id, area_id) with ON UPDATE CASCADE, and the
-- restrictive policy `within_areas` (ADR 0003). The rows travel to a device,
-- to read and to call from. Deleting marks a row: the application role has no
-- DELETE, and a trigger marks the contacts of a property that is marked, at
-- the same moment.
--
-- Everything from the table down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks this table, and
-- nothing it writes is changed.
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"given_name" text,
	"family_name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "contacts_given_name_shaped" CHECK ("contacts"."given_name" is null or ("contacts"."given_name" = btrim("contacts"."given_name") and char_length("contacts"."given_name") between 1 and 80)),
	CONSTRAINT "contacts_family_name_shaped" CHECK ("contacts"."family_name" = btrim("contacts"."family_name") and char_length("contacts"."family_name") between 1 and 80),
	CONSTRAINT "contacts_role_shaped" CHECK ("contacts"."role" is null or ("contacts"."role" = btrim("contacts"."role") and char_length("contacts"."role") between 1 and 80)),
	CONSTRAINT "contacts_phone_shaped" CHECK ("contacts"."phone" is null or ("contacts"."phone" = btrim("contacts"."phone") and char_length("contacts"."phone") between 1 and 40)),
	CONSTRAINT "contacts_email_shaped" CHECK ("contacts"."email" is null or ("contacts"."email" = btrim("contacts"."email") and char_length("contacts"."email") between 1 and 254))
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "contacts_property_idx" ON "contacts" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("contacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("contacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "contacts" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contacts" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "contacts"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "contacts"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The contacts of a marked property are marked with it, at the same moment:
-- nobody asks after the caretaker of a property that is gone, and a device
-- that holds them hears that it may let them go. Only the step from live to
-- deleted: nothing here brings a row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: a contact has
-- the area of its property, so whoever may mark the property sees its
-- contacts. The statement names the tenant.
CREATE FUNCTION "mark_contacts_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	UPDATE public.contacts SET deleted_at = new.deleted_at
	 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contacts_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_contacts_below"();
