-- The duties of an operator (section 2.3 of the concept, ADR 0002, points 10
-- and 11, opengewerk-haustechnik#25): a duty at exactly one of an asset, a
-- room, a building or the property itself, and the proposals of the
-- catalogue the operator dismissed. A proposal is no record; what is kept is
-- the decision, a confirmed duty or a dismissal with its reason and the
-- person.
--
-- A duty from the catalogue names its duty kind with the version that was
-- confirmed and hangs on an asset, because a duty kind is proposed for the
-- kinds of asset its scope names; that the catalogue knows the kind, the
-- route asks, because the catalogue is no table. A duty of the operator's own
-- has its name, its basis and the source it names, and may hang on any of the
-- four. The interval stands in days or in months, and where the kind has a
-- maximum, the maximum of the day the duty was confirmed stands beside it:
-- the database refuses a longer interval, because a confirmed duty does not
-- change quietly when the law does, and a maximum may only be shortened.
-- Under § 14 Abs. 5 BetrSichV the interval is in months.
--
-- Every row carries the property and the area of its place, kept by the key
-- over (tenant_id, property_id, area_id) with ON UPDATE CASCADE, and the
-- restrictive policy `within_areas` (ADR 0003). The rows will travel to a
-- device and carry the columns of the sync; which device holds which comes
-- with the rules of the sync (#27). Deleting marks a row: the application
-- role has no DELETE, and a trigger marks the duties and dismissals of a
-- property, a building, a room or an asset that is marked, at the same moment.
--
-- Everything from the three types down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks these tables, and
-- creating them changes no row anywhere else.

CREATE TYPE "public"."duty_basis" AS ENUM('manufacturer', 'authority', 'insurer', 'own_decision');--> statement-breakpoint
CREATE TYPE "public"."duty_counting" AS ENUM('from_performance', 'from_due', 'betrsichv');--> statement-breakpoint
CREATE TYPE "public"."duty_performer" AS ENUM('own_staff', 'contractor');--> statement-breakpoint
CREATE TABLE "duties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"asset_id" uuid,
	"kind" text,
	"kind_version" integer,
	"label" text,
	"basis" "duty_basis",
	"source_note" text,
	"counting" "duty_counting" NOT NULL,
	"interval_days" integer,
	"interval_months" integer,
	"interval_reason" text,
	"maximum_days" integer,
	"maximum_months" integer,
	"responsible_user_id" text,
	"performer" "duty_performer",
	"performer_note" text,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_on" date,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "duties_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "duties_place" UNIQUE("tenant_id","id","property_id"),
	CONSTRAINT "duties_one_target" CHECK (num_nonnulls("duties"."building_id", "duties"."room_id", "duties"."asset_id") <= 1),
	CONSTRAINT "duties_from_the_catalogue_or_own" CHECK (("duties"."kind" is not null and "duties"."kind_version" is not null and "duties"."asset_id" is not null
          and "duties"."label" is null and "duties"."basis" is null and "duties"."source_note" is null)
        or ("duties"."kind" is null and "duties"."kind_version" is null
          and "duties"."label" is not null and "duties"."basis" is not null and "duties"."source_note" is not null)),
	CONSTRAINT "duties_kind_shaped" CHECK ("duties"."kind" is null or ("duties"."kind" = btrim("duties"."kind") and char_length("duties"."kind") between 1 and 130)),
	CONSTRAINT "duties_kind_version_shaped" CHECK ("duties"."kind_version" is null or "duties"."kind_version" >= 1),
	CONSTRAINT "duties_label_shaped" CHECK ("duties"."label" is null or ("duties"."label" = btrim("duties"."label") and char_length("duties"."label") between 1 and 120)),
	CONSTRAINT "duties_source_note_shaped" CHECK ("duties"."source_note" is null or ("duties"."source_note" = btrim("duties"."source_note") and char_length("duties"."source_note") between 1 and 300)),
	CONSTRAINT "duties_interval_reason_shaped" CHECK ("duties"."interval_reason" is null or ("duties"."interval_reason" = btrim("duties"."interval_reason") and char_length("duties"."interval_reason") between 1 and 500)),
	CONSTRAINT "duties_performer_note_shaped" CHECK ("duties"."performer_note" is null or ("duties"."performer_note" = btrim("duties"."performer_note") and char_length("duties"."performer_note") between 1 and 200)),
	CONSTRAINT "duties_end_reason_shaped" CHECK ("duties"."end_reason" is null or ("duties"."end_reason" = btrim("duties"."end_reason") and char_length("duties"."end_reason") between 1 and 300)),
	CONSTRAINT "duties_end_whole" CHECK ("duties"."end_reason" is null or "duties"."ends_on" is not null),
	CONSTRAINT "duties_interval_one_unit" CHECK (("duties"."interval_days" is null) <> ("duties"."interval_months" is null)),
	CONSTRAINT "duties_interval_in_bounds" CHECK (("duties"."interval_days" is null or "duties"."interval_days" between 1 and 365)
    and ("duties"."interval_months" is null or "duties"."interval_months" between 1 and 600)),
	CONSTRAINT "duties_maximum_one_unit" CHECK ("duties"."maximum_days" is null or "duties"."maximum_months" is null),
	CONSTRAINT "duties_maximum_in_bounds" CHECK (("duties"."maximum_days" is null or "duties"."maximum_days" >= 1)
      and ("duties"."maximum_months" is null or "duties"."maximum_months" >= 1)),
	CONSTRAINT "duties_within_their_maximum" CHECK (("duties"."maximum_days" is null or "duties"."interval_days" <= "duties"."maximum_days")
        and ("duties"."maximum_months" is null or "duties"."interval_months" <= "duties"."maximum_months")),
	CONSTRAINT "duties_betrsichv_in_months" CHECK ("duties"."counting" <> 'betrsichv' or "duties"."interval_months" is not null)
);
--> statement-breakpoint
ALTER TABLE "duties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "duty_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"kind_version" integer NOT NULL,
	"reason" text NOT NULL,
	"dismissed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "duty_dismissals_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "duty_dismissals_kind_shaped" CHECK ("duty_dismissals"."kind" = btrim("duty_dismissals"."kind") and char_length("duty_dismissals"."kind") between 1 and 130),
	CONSTRAINT "duty_dismissals_kind_version_shaped" CHECK ("duty_dismissals"."kind_version" >= 1),
	CONSTRAINT "duty_dismissals_reason_shaped" CHECK ("duty_dismissals"."reason" = btrim("duty_dismissals"."reason") and char_length("duty_dismissals"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "duty_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_at_a_room_of_their_property" FOREIGN KEY ("tenant_id","room_id","property_id") REFERENCES "public"."rooms"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_responsible_works_here" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_confirmed_by_somebody_here" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_dismissals" ADD CONSTRAINT "duty_dismissals_by_somebody_here" FOREIGN KEY ("tenant_id","dismissed_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duties_property_idx" ON "duties" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE INDEX "duties_asset_idx" ON "duties" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duties_kind_once" ON "duties" USING btree ("tenant_id","asset_id","kind") WHERE "duties"."kind" is not null and "duties"."deleted_at" is null and "duties"."ends_on" is null;--> statement-breakpoint
CREATE INDEX "duty_dismissals_asset_idx" ON "duty_dismissals" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duty_dismissals_once" ON "duty_dismissals" USING btree ("tenant_id","asset_id","kind") WHERE "duty_dismissals"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "duties" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("duties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("duties"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "duties" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "duty_dismissals" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("duty_dismissals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("duty_dismissals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "duty_dismissals" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duty_dismissals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "duties" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "duty_dismissals" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "duties"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "duty_dismissals"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "duties"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "duty_dismissals"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- The duties and dismissals of a marked property, building, room or asset are
-- marked with it, at the same moment: a duty of something that is gone calls
-- for nothing. The levels below a marked row mark theirs in turn, by the
-- triggers of the place and the technology. Only the step from live to
-- deleted: nothing here brings a row back.
--
-- Not SECURITY DEFINER, for the reason of `mark_places_below`: everything at a
-- row has its area, so whoever may mark the row sees it all. Every statement
-- names the tenant.
CREATE FUNCTION "mark_duties_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'properties' THEN
		UPDATE public.duties SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
		UPDATE public.duty_dismissals SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND property_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'buildings' THEN
		UPDATE public.duties SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND building_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'rooms' THEN
		UPDATE public.duties SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND room_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'assets' THEN
		UPDATE public.duties SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
		UPDATE public.duty_dismissals SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "duties_follow_deletion" AFTER UPDATE OF "deleted_at" ON "properties"
	FOR EACH ROW EXECUTE FUNCTION "mark_duties_below"();--> statement-breakpoint
CREATE TRIGGER "duties_follow_deletion" AFTER UPDATE OF "deleted_at" ON "buildings"
	FOR EACH ROW EXECUTE FUNCTION "mark_duties_below"();--> statement-breakpoint
CREATE TRIGGER "duties_follow_deletion" AFTER UPDATE OF "deleted_at" ON "rooms"
	FOR EACH ROW EXECUTE FUNCTION "mark_duties_below"();--> statement-breakpoint
CREATE TRIGGER "duties_follow_deletion" AFTER UPDATE OF "deleted_at" ON "assets"
	FOR EACH ROW EXECUTE FUNCTION "mark_duties_below"();
