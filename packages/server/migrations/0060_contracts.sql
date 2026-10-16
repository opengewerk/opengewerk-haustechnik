-- The contracts with the contractors and the warranty (#329, section 4.11 of the concept).
--
-- `contracts`: a contract with a firm of the list, its term with how it
-- renews and the notice it takes, and its response time, price and note as
-- words. Tenant-wide and without an area like the firm (decided 15.10.2026):
-- the policy `tenant_isolation` alone, FORCE, and no DELETE for the
-- application role, as a contract entered by mistake is marked. Its rows
-- travel only to the devices of whoever reads the contracts.
--
-- `contract_items`: what a contract covers, a building whole or an asset,
-- each with the property and the area of what it names and the restrictive
-- policy `within_areas`, so that a contract shows what it covers only from
-- the areas of whoever reads it. A row taken out again is removed.
--
-- `duties.contract_id`: the contract a duty fulfils, over a key with the
-- firm of the duty, so that it is a contract of that firm.
-- `work_orders.warranty_ends_on`: the warranty of an accepted work order.
-- `attachments.contract_id`: a document of a contract, which like the
-- document of a firm lies in no area. A contract that is marked takes its
-- documents along.
-- `deadlines`: the last day to give notice and the end of a contract, without
-- a place, and the end of the warranty of an asset or of a work order, where
-- these lie.
--
-- The rights "Verträge ansehen" (`contract.read`: Leitung, Technische
-- Leitung, Objektleitung) and "Verträge führen" (`contract.write`: Leitung,
-- Technische Leitung), decided on 15.10.2026, for the tenants that are
-- already there, as in 0046. The keys onto the contracts, the assets and the
-- work orders are laid while none of the tables is under FORCE, as 0051 does
-- it (#315).

CREATE TABLE "contract_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"building_id" uuid,
	"asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_items_one_target" CHECK (num_nonnulls("contract_items"."building_id", "contract_items"."asset_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "contract_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"renewal_months" integer,
	"notice_amount" integer,
	"notice_unit" text,
	"cancelled_to" date,
	"response_time" text,
	"price" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "contracts_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contracts_of_their_contractor" UNIQUE("tenant_id","id","contractor_id"),
	CONSTRAINT "contracts_title_shaped" CHECK ("contracts"."title" = btrim("contracts"."title") and char_length("contracts"."title") between 1 and 120),
	CONSTRAINT "contracts_response_time_shaped" CHECK ("contracts"."response_time" is null or ("contracts"."response_time" = btrim("contracts"."response_time") and char_length("contracts"."response_time") between 1 and 120)),
	CONSTRAINT "contracts_price_shaped" CHECK ("contracts"."price" is null or ("contracts"."price" = btrim("contracts"."price") and char_length("contracts"."price") between 1 and 120)),
	CONSTRAINT "contracts_note_shaped" CHECK ("contracts"."note" is null or ("contracts"."note" = btrim("contracts"."note") and char_length("contracts"."note") between 1 and 500)),
	CONSTRAINT "contracts_renewal_shaped" CHECK ("contracts"."renewal_months" is null or ("contracts"."renewal_months" between 1 and 120 and "contracts"."ends_on" is not null)),
	CONSTRAINT "contracts_notice_shaped" CHECK (("contracts"."notice_amount" is null and "contracts"."notice_unit" is null) or ("contracts"."notice_amount" between 1 and 99 and "contracts"."notice_unit" in ('weeks', 'months'))),
	CONSTRAINT "contracts_term_in_order" CHECK (("contracts"."ends_on" is null or "contracts"."ends_on" >= "contracts"."starts_on") and ("contracts"."cancelled_to" is null or "contracts"."cancelled_to" >= "contracts"."starts_on"))
);
--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_at_a_place_or_of_a_document";--> statement-breakpoint
ALTER TABLE "deadlines" DROP CONSTRAINT "deadlines_follow_one_source";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_at_a_place_or_a_contractor";--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "warranty_ends_on" date;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "warranty_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "warranty_order_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_of_a_contract" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_follow_their_building" FOREIGN KEY ("tenant_id","building_id","area_id") REFERENCES "public"."buildings"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_follow_their_asset" FOREIGN KEY ("tenant_id","asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_at_a_building_of_their_property" FOREIGN KEY ("tenant_id","building_id","property_id") REFERENCES "public"."buildings"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_at_an_asset_of_their_property" FOREIGN KEY ("tenant_id","asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_with_a_contractor" FOREIGN KEY ("tenant_id","contractor_id") REFERENCES "public"."contractors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_items_building_once" ON "contract_items" USING btree ("tenant_id","contract_id","building_id") WHERE "contract_items"."building_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_items_asset_once" ON "contract_items" USING btree ("tenant_id","contract_id","asset_id") WHERE "contract_items"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "contract_items_building_idx" ON "contract_items" USING btree ("tenant_id","building_id");--> statement-breakpoint
CREATE INDEX "contract_items_asset_idx" ON "contract_items" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE INDEX "contracts_contractor_idx" ON "contracts" USING btree ("tenant_id","contractor_id");--> statement-breakpoint
ALTER TABLE "duties" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_on_a_contract_of_their_contractor" FOREIGN KEY ("tenant_id","contract_id","contractor_id") REFERENCES "public"."contracts"("tenant_id","id","contractor_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_contract" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_asset" FOREIGN KEY ("tenant_id","warranty_asset_id","area_id") REFERENCES "public"."assets"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_an_asset_of_their_property" FOREIGN KEY ("tenant_id","warranty_asset_id","property_id") REFERENCES "public"."assets"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_work_order" FOREIGN KEY ("tenant_id","warranty_order_id","area_id") REFERENCES "public"."work_orders"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_work_order_of_their_property" FOREIGN KEY ("tenant_id","warranty_order_id","property_id") REFERENCES "public"."work_orders"("tenant_id","id","property_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_of_a_contract" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "duties_contract_idx" ON "duties" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "deadlines_contract_idx" ON "deadlines" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "deadlines_warranty_asset_idx" ON "deadlines" USING btree ("tenant_id","warranty_asset_id");--> statement-breakpoint
CREATE INDEX "deadlines_warranty_order_idx" ON "deadlines" USING btree ("tenant_id","warranty_order_id");--> statement-breakpoint
CREATE INDEX "attachments_contract_idx" ON "attachments" USING btree ("tenant_id","contract_id");--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_contract_with_its_contractor" CHECK ("duties"."contract_id" is null or "duties"."contractor_id" is not null);--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_at_a_place_or_of_a_document" CHECK (("deadlines"."area_id" is null) = ("deadlines"."property_id" is null) and ("deadlines"."property_id" is not null or "deadlines"."attachment_id" is not null or "deadlines"."contract_id" is not null) and ("deadlines"."contract_id" is null or "deadlines"."property_id" is null));--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_one_source" CHECK (num_nonnulls("deadlines"."duty_id", "deadlines"."defect_id", "deadlines"."round_plan_id", "deadlines"."meter_property_id", "deadlines"."attachment_id", "deadlines"."contract_id", "deadlines"."warranty_asset_id", "deadlines"."warranty_order_id") = 1);--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_at_a_place_or_a_contractor" CHECK (num_nonnulls("attachments"."property_id", "attachments"."contractor_id", "attachments"."contract_id") = 1 and ("attachments"."area_id" is null) = ("attachments"."property_id" is null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contract_items" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("contract_items"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("contract_items"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "contract_items" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contracts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("contracts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("contracts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "contracts" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_items" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "contracts"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "contracts"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "contract_items"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
-- Not SECURITY DEFINER, for the reason of `mark_below_a_contractor`: the
-- documents of a contract lie in no area, so whoever may mark the contract
-- sees them. The statement names the tenant.
CREATE FUNCTION "mark_below_a_contract"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	UPDATE public.attachments SET deleted_at = new.deleted_at
	 WHERE tenant_id = new.tenant_id AND contract_id = new.id AND deleted_at IS NULL;

	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "documents_follow_deletion" AFTER UPDATE OF "deleted_at" ON "contracts"
	FOR EACH ROW EXECUTE FUNCTION "mark_below_a_contract"();--> statement-breakpoint

-- The two rights for the tenants that are already there, as in 0046.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" AS "role"
   SET "rights" = "role"."rights" || "missing"."rights",
       "updated_at" = now()
  FROM (
	SELECT "held"."id",
	       array_agg("shipped"."right" ORDER BY "shipped"."position") AS "rights"
	  FROM "tenant_roles" AS "held"
	  JOIN (
		VALUES
			('management', ARRAY['contract.read', 'contract.write']::text[]),
			('technical_management', ARRAY['contract.read', 'contract.write']::text[]),
			('site_management', ARRAY['contract.read']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
