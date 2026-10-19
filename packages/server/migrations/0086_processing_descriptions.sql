-- The description of the processing as the application makes it (#357,
-- section 9 of the concept, decided on 15.10.2026).
--
-- `processing_descriptions`: every description the Leitung made, with its
-- whole text, the version it holds for and the sections that differ from the
-- one before. Each stays with its day, so that a works council can read what
-- changed: the application may read a row and add one, nothing else.
-- Tenant-wide and without an area: the policy `tenant_isolation` alone,
-- FORCE. The key onto the memberships is laid on a table without rows, so
-- nothing has to be checked against them.
--
-- The right "Auskunft, Verfahrensbeschreibung und Verzeichnis erzeugen"
-- (`privacy.generate`) for the tenants that are there, as in 0079: the Leitung
-- alone.
--
-- **Fits the version before it.** That version knows neither the table nor the
-- right, and a role that holds a right it does not know is a role it reads as
-- it is.
CREATE TABLE "processing_descriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"made_by" text NOT NULL,
	"holds_for" text,
	"text" text NOT NULL,
	"changed" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_descriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processing_descriptions" ADD CONSTRAINT "processing_descriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_descriptions" ADD CONSTRAINT "processing_descriptions_made_here" FOREIGN KEY ("tenant_id","made_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_descriptions_newest" ON "processing_descriptions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "processing_descriptions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("processing_descriptions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("processing_descriptions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "processing_descriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A description is written once and stays.
GRANT SELECT, INSERT ON "processing_descriptions" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "processing_descriptions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
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
			('management', ARRAY['privacy.generate']::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
