-- The appointment of a duty (section 2.4 of the concept, ADR 0002, point 12,
-- opengewerk-haustechnik#25): the row of an evidence, which says which duty
-- was met on which day with which result, and the deadlines the engine of the
-- foundation keeps from it.
--
-- `evidence` is the row ADR 0004 describes in its point 1, as far as the
-- deadline needs it. The application may read and add a row and nothing else:
-- an evidence is never changed and never removed. The frozen state, the
-- number, the signature, corrections and invalidity come with
-- opengewerk-haustechnik#26; until then no route writes one.
--
-- `deadlines` is the table of the foundation (`deadlinesSchema`, ADR 0010 in
-- the repository opengewerk) with what this application gives it: the duty a
-- deadline follows, with its property and its area, and the restrictive
-- policy `within_areas`, so that a deadline stays in the areas of the person
-- who asks. The comparison with the building blocks takes columns, keys,
-- index and policy as this application's own (`foundation.test.ts`). The
-- rights are those of `deadlinesGuard`: written and changed by the engine and
-- the routes, never removed, a dropped deadline keeps its row; watched by the
-- log, and no columns of the sync, because a deadline is worked out on the
-- server.
--
-- Both carry the property and the area of their duty, kept by the key over
-- (tenant_id, property_id, area_id) with ON UPDATE CASCADE (ADR 0003).
--
-- Everything from the two types down to the policies is what drizzle-kit
-- generated from the schema. What follows the policies is written by hand.
--
-- **Fits the version before it.** That version never asks these tables, and
-- creating them changes no row anywhere else.

CREATE TYPE "public"."evidence_result" AS ENUM('without_defects', 'with_defects', 'failed', 'not_performed');--> statement-breakpoint
CREATE TYPE "public"."deadline_status" AS ENUM('open', 'done', 'dropped');--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"duty_id" uuid NOT NULL,
	"performed_on" date NOT NULL,
	"result" "evidence_result" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_label" text NOT NULL,
	"anchor_on" date NOT NULL,
	"due_on" date NOT NULL,
	"lead_days" integer,
	"responsible_user_id" text,
	"natural_user_id" text,
	"status" "deadline_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"reminded_for" date,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duty_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	CONSTRAINT "deadlines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "deadlines_once_per_source" UNIQUE("tenant_id","kind","source_id"),
	CONSTRAINT "deadlines_lead_in_bounds" CHECK ("deadlines"."lead_days" is null or "deadlines"."lead_days" between 0 and 365),
	CONSTRAINT "deadlines_closed_when_not_open" CHECK (("deadlines"."status" = 'open') = ("deadlines"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "deadlines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_follows_its_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_of_a_duty_of_its_property" FOREIGN KEY ("tenant_id","duty_id","property_id") REFERENCES "public"."duties"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_responsible_works_here" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_follow_their_property" FOREIGN KEY ("tenant_id","property_id","area_id") REFERENCES "public"."properties"("tenant_id","id","area_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_of_a_duty_of_their_property" FOREIGN KEY ("tenant_id","duty_id","property_id") REFERENCES "public"."duties"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_duty_idx" ON "evidence" USING btree ("tenant_id","duty_id","performed_on");--> statement-breakpoint
CREATE INDEX "deadlines_due_idx" ON "deadlines" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "deadlines_duty_idx" ON "deadlines" USING btree ("tenant_id","duty_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("evidence"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("evidence"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "evidence" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "deadlines" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("deadlines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("deadlines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "within_areas" ON "deadlines" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])) WITH CHECK ((SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[]));--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "evidence" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "deadlines" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "evidence"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "deadlines"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
