-- Two tables the foundation brings with it since opengewerk-haustechnik#23
-- (ADR 0010 in the repository opengewerk): the files of a tenant by their
-- SHA-256 and the mail server of a tenant. They are tables of the foundation
-- and stand in its building blocks, so every application that carries the
-- foundation has them; `foundation.test.ts` compares this database with one
-- built from the blocks alone.
--
-- Nothing in this application writes either of them yet. The store for the
-- files comes with the documents of phase 1, the mail server with the
-- notifications; until then an invitation goes out as a link. The password of
-- a mail server is not in this table but sealed in `secrets`, under the
-- purpose `smtp_password` that the initial migration created.
--
-- The rights are the foundation's: a file is read and inserted, never changed
-- and never removed, because the bytes behind a row never change and a record
-- that points at one outlives every mistake; a mail server is set up, changed
-- and removed again, and the log sees each of them.
--
-- Everything from the type down to the policies is what drizzle-kit generated
-- from the schema of the foundation. What follows the policies is written by
-- hand, as the description of the two tables in the foundation says
-- (`foundationGuards`).
--
-- **Fits the version before it.** That version never asks these tables, and
-- creating them changes no row anywhere else.

CREATE TYPE "public"."mail_security" AS ENUM('starttls', 'tls', 'none');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"media_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "files_sha256_is_hex" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_size_not_negative" CHECK ("files"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" "mail_security" NOT NULL,
	"username" text,
	"from_address" text NOT NULL,
	"signature" text,
	"password_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_content" ON "files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_settings_tenant" ON "mail_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("files"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("files"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mail_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("mail_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("mail_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "files" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mail_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "files"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "mail_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
