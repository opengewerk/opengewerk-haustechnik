-- The mail outbox and push (#126): every message an operator sends by mail,
-- written when something is due and sent afterwards by the job, and the
-- devices that take push messages, the occasions a person switched off, and
-- every push message before and after it went out.
--
-- Everything down to the last policy comes from the schema. What follows it is
-- written by hand: FORCE, the grants and the audit trigger on all four tables.
--
-- **Why no DELETE on the mail outbox.** A message is never taken back out,
-- sent or not: a row that says a reminder went to somebody on a certain day is
-- part of what happened.
--
-- **Why no place, no key onto a deadline and no sync columns.** A row is what
-- the operator told one person or one device, and it carries no area. A key
-- onto the deadline a reminder is about would be a key onto a row with a
-- place that does not run over the property (ADR 0003); the cause of the
-- message names the deadline, and that is enough to write it once. A device
-- subscribes and unsubscribes through its routes while it is online, and a
-- message is written and sent on the server; nothing here travels in the
-- outbox of a device.
--
-- **Why the push rows go when a person leaves.** The subscriptions and the
-- choices hang on the membership and are removed with it, and the messages
-- hang on their subscription the same way: they are what the operator told
-- its own people about today, not a record it owes anybody.

CREATE TYPE "public"."mail_kind" AS ENUM('deadline_due', 'invitation');--> statement-breakpoint
CREATE TYPE "public"."mail_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."push_entry" AS ENUM('office', 'site');--> statement-breakpoint
CREATE TYPE "public"."push_kind" AS ENUM('deadline_due', 'assigned', 'task_due', 'waiting', 'work_order_rejected', 'test');--> statement-breakpoint
CREATE TYPE "public"."push_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "mail_kind" NOT NULL,
	"cause" text NOT NULL,
	"invitation_id" uuid,
	"requested_by" text,
	"sender_name" text NOT NULL,
	"reply_to" text,
	"recipient_address" text NOT NULL,
	"recipient_name" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "mail_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_once_per_cause" UNIQUE("tenant_id","cause")
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"occasion" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_opt_outs_once" UNIQUE("tenant_id","user_id","occasion")
);
--> statement-breakpoint
ALTER TABLE "push_opt_outs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "push_kind" NOT NULL,
	"cause" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"status" "push_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_outbox_once_per_cause" UNIQUE("tenant_id","cause","subscription_id")
);
--> statement-breakpoint
ALTER TABLE "push_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"entry" "push_entry" NOT NULL,
	"label" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "push_subscriptions_once_per_endpoint" UNIQUE("tenant_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_invitation_in_tenant" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."invitations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_opt_outs" ADD CONSTRAINT "push_opt_outs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_opt_outs" ADD CONSTRAINT "push_opt_outs_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_subscription_in_tenant" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."push_subscriptions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "mail_outbox" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_invitation_idx" ON "mail_outbox" USING btree ("tenant_id","invitation_id");--> statement-breakpoint
CREATE INDEX "push_outbox_due_idx" ON "push_outbox" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "push_outbox_subscription_idx" ON "push_outbox" USING btree ("tenant_id","subscription_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_person_idx" ON "push_subscriptions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mail_outbox" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("mail_outbox"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("mail_outbox"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_opt_outs" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("push_opt_outs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("push_opt_outs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_outbox" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("push_outbox"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("push_outbox"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("push_subscriptions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("push_subscriptions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mail_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_opt_outs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mail_outbox" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "push_opt_outs" TO "opengewerk_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_outbox" TO "opengewerk_app";--> statement-breakpoint

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "mail_outbox"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "push_subscriptions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "push_opt_outs"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "push_outbox"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
