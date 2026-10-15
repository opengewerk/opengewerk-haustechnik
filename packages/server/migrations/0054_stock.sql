-- The stores of the operator (#325, section 4.12 of the concept), made with
-- the factory of the foundation (ADR 0011 in the repository opengewerk).
--
-- Five tables: `articles` (with the price of this application, an indication
-- for the view of costs), `suppliers`, `stores`, `store_articles` (the
-- minimum a store keeps of an article) and `stock_movements`, the bookings
-- the stock is made of. Tenant-wide and without an area (2.8), so no key over
-- a property; every device holds them. An article, a supplier and a store are
-- marked and never removed: the application may read, add and change them,
-- and has no DELETE. A booking is written once: the application may read and
-- add one, and a trigger refuses a change and a removal to every role.
--
-- The rights "Lager ansehen" (`store.read`, all four roles) and "Lager
-- führen" (`store.write`, Leitung, Technische Leitung and Objektleitung) are
-- written into the rows of the tenants that are already there, as 0046 does
-- for the rights before it: a row gets what it lacks, behind what it has, and
-- the log names the migration.

CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"designation" text NOT NULL,
	"description" text,
	"ean" text,
	"unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	"price_cents" integer,
	CONSTRAINT "articles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "articles_number_fits" CHECK (char_length("articles"."number") between 1 and 40),
	CONSTRAINT "articles_designation_fits" CHECK (char_length("articles"."designation") between 1 and 200),
	CONSTRAINT "articles_description_fits" CHECK ("articles"."description" is null or char_length("articles"."description") <= 2000),
	CONSTRAINT "articles_ean_shaped" CHECK ("articles"."ean" ~ '^([0-9]{8}|[0-9]{13})$'),
	CONSTRAINT "articles_unit_known" CHECK ("articles"."unit" in ('piece', 'metre', 'square_metre', 'kilogram', 'litre', 'package')),
	CONSTRAINT "articles_price_from_zero" CHECK ("articles"."price_cents" is null or "articles"."price_cents" between 0 and 99999999)
);
--> statement-breakpoint
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"supplier_id" uuid,
	"reason" text,
	"booked_by" text NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_movements_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stock_movements_kind_known" CHECK ("stock_movements"."kind" in ('receipt', 'count', 'withdrawal')),
	CONSTRAINT "stock_movements_quantity_from_zero" CHECK ("stock_movements"."quantity_milli" between 0 and 1000000000),
	CONSTRAINT "stock_movements_moves_something" CHECK ("stock_movements"."kind" = 'count' or "stock_movements"."quantity_milli" > 0),
	CONSTRAINT "stock_movements_count_with_a_reason" CHECK ("stock_movements"."kind" <> 'count' or "stock_movements"."reason" is not null),
	CONSTRAINT "stock_movements_reason_fits" CHECK ("stock_movements"."reason" is null or char_length("stock_movements"."reason") <= 500),
	CONSTRAINT "stock_movements_supplier_at_a_receipt" CHECK ("stock_movements"."supplier_id" is null or "stock_movements"."kind" = 'receipt')
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"minimum_milli" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "store_articles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "store_articles_once" UNIQUE("tenant_id","store_id","article_id"),
	CONSTRAINT "store_articles_minimum_from_zero" CHECK ("store_articles"."minimum_milli" is null or "store_articles"."minimum_milli" between 0 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "store_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "stores_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "stores_name_fits" CHECK (char_length("stores"."name") between 1 and 120),
	CONSTRAINT "stores_location_fits" CHECK ("stores"."location" is null or char_length("stores"."location") <= 200)
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_number" text,
	"email" text,
	"phone" text,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"device_id" text,
	"deleted_at" timestamp with time zone,
	"change_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "suppliers_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_name_fits" CHECK (char_length("suppliers"."name") between 1 and 200),
	CONSTRAINT "suppliers_customer_number_fits" CHECK ("suppliers"."customer_number" is null or char_length("suppliers"."customer_number") <= 40),
	CONSTRAINT "suppliers_country_code" CHECK ("suppliers"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_in_a_store_here" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_of_an_article_here" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_a_supplier_here" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_by_somebody_here" FOREIGN KEY ("tenant_id","booked_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_in_a_store_here" FOREIGN KEY ("tenant_id","store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_of_an_article_here" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_number_once" ON "articles" USING btree ("tenant_id",lower("number")) WHERE "articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "articles_ean_idx" ON "articles" USING btree ("tenant_id","ean") WHERE "articles"."ean" is not null and "articles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "stock_movements_of_an_article_idx" ON "stock_movements" USING btree ("tenant_id","store_id","article_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "articles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_movements" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("stock_movements"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("stock_movements"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_articles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("store_articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("store_articles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stores" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("stores"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("stores"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "suppliers" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("suppliers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("suppliers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "articles" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "suppliers" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stores" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "store_articles" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "stock_movements" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "articles"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "suppliers"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "suppliers"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "stores"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "stores"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "store_articles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "store_articles"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();--> statement-breakpoint

-- No change and no removal of a booking, for any role. It runs before
-- `stamp_sync_columns`, triggers of one kind running in the order of their
-- names.
CREATE FUNCTION "booking_kept_as_written"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	RAISE EXCEPTION 'Eine Buchung im Lager wird nicht geändert und nicht gelöscht. Was nicht stimmt, berichtigt eine Zählung.'
		USING ERRCODE = 'HT005';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "kept_as_written" BEFORE UPDATE OR DELETE ON "stock_movements"
	FOR EACH ROW EXECUTE FUNCTION "booking_kept_as_written"();--> statement-breakpoint
CREATE TRIGGER "kept_whole" BEFORE TRUNCATE ON "stock_movements"
	FOR EACH STATEMENT EXECUTE FUNCTION "booking_kept_as_written"();--> statement-breakpoint

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
			('management', ARRAY['store.read', 'store.write']::text[]),
			('technical_management', ARRAY['store.read', 'store.write']::text[]),
			('site_management', ARRAY['store.read', 'store.write']::text[]),
			('technician', ARRAY['store.read']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
