-- A correction of the name or the address of an account, made by whoever
-- administers the tenant, as a row of the tenant (opengewerk-haustechnik#84):
-- the table `account_corrections` of the foundation (ADR 0010 of the
-- repository opengewerk). It comes with the commit of the foundation that
-- brings the route for it, and reaches this database through this migration.
--
-- The name and the address belong to the account and so to the instance, and
-- `auth_users` has no tenant and no audit trigger. A correction made from
-- inside a tenant is the doing of that tenant all the same: one row per
-- correction says what was changed into what, and the audit trigger puts it
-- into the log of the tenant, as it does with `member_passkeys` for a passkey.
--
-- A row says what happened at one moment, so the grant stops at INSERT.
-- Nothing changes it afterwards and nothing removes it; the cascade from
-- `memberships` is the one way a row goes, and a membership is blocked rather
-- than deleted. A correction of the name alone says nothing about the
-- address, and the other way round: each half comes as a pair or not at all,
-- and one of them is there, which the three checks hold a row to.
--
-- A row has no place and no area. It hangs on a membership, like the areas
-- somebody holds in, and it does not travel to a device.
--
-- Everything from the table down to the policy is what drizzle-kit generated
-- from the schema. What follows the policy is written by hand.
--
-- **Fits the version before it.** That version knows no route that writes
-- this table, and nothing it writes is changed.
CREATE TABLE "account_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name_before" text,
	"name_after" text,
	"email_before" text,
	"email_after" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_corrections_name_in_a_pair" CHECK (("account_corrections"."name_before" is null) = ("account_corrections"."name_after" is null)),
	CONSTRAINT "account_corrections_email_in_a_pair" CHECK (("account_corrections"."email_before" is null) = ("account_corrections"."email_after" is null)),
	CONSTRAINT "account_corrections_names_a_change" CHECK ("account_corrections"."name_after" is not null or "account_corrections"."email_after" is not null)
);
--> statement-breakpoint
ALTER TABLE "account_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_corrections" ADD CONSTRAINT "account_corrections_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_corrections" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("account_corrections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("account_corrections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "account_corrections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "account_corrections" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "account_corrections"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
