-- What an invitation says about the areas of whoever takes it up
-- (opengewerk-haustechnik#84, ADR 0003).
--
-- The Leitung invites somebody with a role and with the areas they are to
-- work in, in one step. Until now an invitation carried the role alone: the
-- areas of a membership could only be named once the person had joined, and
-- until somebody did they began with what `0002_areas` gives a new
-- membership. With more than one area that is none, and the first thing a new
-- colleague saw was an empty list.
--
-- Two tables, beside the invitation and not on it, for the reason
-- `member_all_areas` is a table of its own: the invitation belongs to the
-- foundation, and a column of this application on it would be a deviation
-- every comparison with the building blocks reports.
--
-- - `invitation_area_choices`: one row for an invitation that says something
--   about areas, with whether it is every area or the ones named.
-- - `invitation_areas`: an area the invitation names, under its choice.
--
-- An invitation without a choice says nothing, and the membership it becomes
-- begins with what the database gives a new one. An invitation whose choice
-- names areas and has none left, because the last of them was removed, means
-- none: the row of the area goes with the area, the choice stays.
--
-- The application writes both with the invitation, in the transaction of the
-- foundation that writes the invitation, and never changes them: an
-- invitation is not edited, it is replaced by a new one. So the application
-- role may read and insert, and nothing else. What removes a row is the key
-- to the area, and the database follows a key as the owner of the table.
--
-- Everything down to the policies is what drizzle-kit generated from the
-- schema. What follows it is written by hand: the audit trigger on both
-- tables, FORCE and the grants.
--
-- **Fits the version before it.** That version never asks these tables, and
-- an invitation it writes after this migration has no choice, which is what
-- an invitation without a word about areas looks like.

CREATE TABLE "invitation_area_choices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"every_area" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_area_choices_once" UNIQUE("tenant_id","invitation_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_area_choices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitation_areas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_areas_once" UNIQUE("tenant_id","invitation_id","area_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_area_choices" ADD CONSTRAINT "invitation_area_choices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_area_choices" ADD CONSTRAINT "invitation_area_choices_of_an_invitation" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_areas" ADD CONSTRAINT "invitation_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_areas" ADD CONSTRAINT "invitation_areas_under_a_choice" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."invitation_area_choices"("tenant_id","invitation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_areas" ADD CONSTRAINT "invitation_areas_area_of_the_tenant" FOREIGN KEY ("tenant_id","area_id") REFERENCES "public"."areas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitation_area_choices" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("invitation_area_choices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invitation_area_choices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitation_areas" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("invitation_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invitation_areas"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "invitation_area_choices"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "invitation_areas"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
ALTER TABLE "invitation_area_choices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "invitation_area_choices" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "invitation_areas" TO "opengewerk_app";
