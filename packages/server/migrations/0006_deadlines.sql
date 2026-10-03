-- Two tables the foundation brings with it since opengewerk-haustechnik#24
-- (ADR 0010 in the repository opengewerk): what a tenant sets for a kind of
-- deadline, and when the deadline engine last went through a tenant and when
-- it failed there. They are tables of the foundation and stand in its
-- building blocks, so every application that carries the foundation has them;
-- `foundation.test.ts` compares this database with one built from the blocks
-- alone.
--
-- Nothing in this application writes either of them yet. The deadlines
-- themselves come with the duties (opengewerk-haustechnik#25), in a table this
-- application makes with columns of its own, and with them the engine that
-- writes its passes here.
--
-- The rights are the foundation's: a setting is written and changed, never
-- removed, because a setting put back to the kind's own values is a row of
-- nulls and the log keeps what it was before; a pass of the engine is written
-- and changed after every run, never removed, and kept out of the log, which
-- it would fill once a minute.
--
-- Everything down to the policies is what drizzle-kit generated from the
-- schema of the foundation. What follows the policies is written by hand, as
-- the description of the two tables in the foundation says
-- (`foundationGuards`).
--
-- **Fits the version before it.** That version never asks these tables, and
-- creating them changes no row anywhere else.

CREATE TABLE "deadline_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deadline_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lead_days" integer,
	"interval_days" integer,
	"interval_months" integer,
	"responsible_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_settings_once_per_kind" UNIQUE("tenant_id","kind"),
	CONSTRAINT "deadline_settings_lead_in_bounds" CHECK ("deadline_settings"."lead_days" is null or "deadline_settings"."lead_days" between 0 and 365),
	CONSTRAINT "deadline_settings_interval_in_bounds" CHECK ("deadline_settings"."interval_days" is null or "deadline_settings"."interval_days" between 1 and 365),
	CONSTRAINT "deadline_settings_interval_months_in_bounds" CHECK ("deadline_settings"."interval_months" is null or "deadline_settings"."interval_months" between 1 and 600),
	CONSTRAINT "deadline_settings_one_unit" CHECK ("deadline_settings"."interval_days" is null or "deadline_settings"."interval_months" is null)
);
--> statement-breakpoint
ALTER TABLE "deadline_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadline_runs" ADD CONSTRAINT "deadline_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_responsible_works_here" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_runs_tenant" ON "deadline_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deadline_runs" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("deadline_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("deadline_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deadline_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("deadline_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("deadline_settings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "deadline_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadline_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "deadline_runs" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "deadline_settings" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "deadline_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
