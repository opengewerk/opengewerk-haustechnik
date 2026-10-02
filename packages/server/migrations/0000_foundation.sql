-- The foundation (ADR 0010 in the repository "opengewerk"): the tables every
-- application of the organisation carries, and what keeps tenants apart and
-- the log complete around them.
--
-- Put together by `completeInitialMigration` of @opengewerk/platform-server.
-- The tables, keys and policies in the second part are what drizzle-kit
-- generated from the schema; everything else is a building block of the
-- foundation, which knows what drizzle-kit does not: the role, FORCE, the
-- grants, the functions and the triggers.
--
-- From here on this file is frozen like every migration. A correction is a
-- new migration, because this one has run on somebody's database.

-- Part 1 of 5: the role. First, because the policies below name it.

-- The role the application connects as, and its way into the schema.
--
-- Row level security never applies to a superuser, and it applies to the owner
-- of a table only where the table says FORCE. The application therefore
-- connects as a role of its own that is neither: no superuser rights and no
-- ownership of any table. What it may do with a table is granted table by
-- table, further down in the migration this block is part of.
--
-- The role gets no password and no LOGIN here. Whoever sets the instance up
-- gives it both; credentials do not belong in a file that sits in every clone
-- of a repository.
--
-- Created only when it is missing: a role belongs to the cluster and not to
-- the database, so a second database on the same server finds it there.

DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opengewerk_app') THEN
		CREATE ROLE "opengewerk_app" NOLOGIN;
	END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "opengewerk_app";--> statement-breakpoint

-- Part 2 of 5: the tables, as drizzle-kit generated them.

CREATE TYPE "public"."audit_operation" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."sign_in_method" AS ENUM('password', 'passkey');--> statement-breakpoint
CREATE TYPE "public"."conflict_reason" AS ENUM('changed_elsewhere', 'record_is_fixed', 'online_only', 'record_missing', 'unknown_entity', 'set_by_server');--> statement-breakpoint
CREATE TYPE "public"."operation_outcome" AS ENUM('applied', 'conflict', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."number_range_key" AS ENUM('asset', 'evidence');--> statement-breakpoint
CREATE TYPE "public"."secret_purpose" AS ENUM('smtp_password');--> statement-breakpoint
CREATE TABLE "audit_chains" (
	"tenant_id" uuid NOT NULL,
	"next_sequence" bigint DEFAULT 1 NOT NULL,
	"head_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_chains_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "audit_chains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"operation" "audit_operation" NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" bigint NOT NULL,
	"previous_hash" text,
	"hash" text NOT NULL,
	"user_id" text,
	"reason" text,
	"database_role" text NOT NULL,
	CONSTRAINT "audit_entries_sequence" UNIQUE("tenant_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_tenant_id" uuid,
	"device_id" text,
	"long_lived" boolean DEFAULT false NOT NULL,
	"sign_in_method" "sign_in_method" DEFAULT 'password' NOT NULL,
	"reconfirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_two_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "auth_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "instance_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"change_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"operation" "audit_operation" NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"reason" text,
	"database_role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "instance_operators" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_operators_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "instance_operators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"mail_internal_hosts" text[] DEFAULT '{}'::text[] NOT NULL,
	"backup_time" time DEFAULT '02:30' NOT NULL,
	"imported_from_environment_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_one_row" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token" UNIQUE("token_hash"),
	CONSTRAINT "invitations_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"passkey_id" text NOT NULL,
	"name" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_passkeys_once" UNIQUE("tenant_id","passkey_id")
);
--> statement-breakpoint
ALTER TABLE "member_passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"roles" text[] NOT NULL,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_one_per_user" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"device_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"sign_in_method" "sign_in_method" DEFAULT 'password' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"reason" "conflict_reason" NOT NULL,
	"fields" text[] NOT NULL,
	"wanted" jsonb NOT NULL,
	"seen" jsonb NOT NULL,
	"found" jsonb NOT NULL,
	"device_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"outcome" "operation_outcome" NOT NULL,
	"device_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_sequences" (
	"tenant_id" uuid NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_sequences_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "sync_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"rights" text[] NOT NULL,
	"leads" boolean DEFAULT false NOT NULL,
	"second_factor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_roles_key_once" UNIQUE("tenant_id","key"),
	CONSTRAINT "tenant_roles_key_plain" CHECK ("tenant_roles"."key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "tenant_roles_label_shaped" CHECK ("tenant_roles"."label" = btrim("tenant_roles"."label") and char_length("tenant_roles"."label") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "tenant_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "number_ranges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" "number_range_key" NOT NULL,
	"pattern" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_ranges_tenant_key" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "number_ranges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" "secret_purpose" NOT NULL,
	"record_id" uuid,
	"sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_one_per_record" UNIQUE NULLS NOT DISTINCT("tenant_id","purpose","record_id")
);
--> statement-breakpoint
ALTER TABLE "secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_chains" ADD CONSTRAINT "audit_chains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_operators" ADD CONSTRAINT "instance_operators_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_auth_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_passkeys" ADD CONSTRAINT "member_passkeys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_passkeys" ADD CONSTRAINT "member_passkeys_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sessions" ADD CONSTRAINT "tenant_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sessions" ADD CONSTRAINT "tenant_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_sequences" ADD CONSTRAINT "sync_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_ranges" ADD CONSTRAINT "number_ranges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_record_idx" ON "audit_entries" USING btree ("tenant_id","table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_entries_time_idx" ON "audit_entries" USING btree ("tenant_id","changed_at");--> statement-breakpoint
CREATE INDEX "instance_changes_time_idx" ON "instance_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "invitations_open_idx" ON "invitations" USING btree ("tenant_id","redeemed_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_open_idx" ON "sync_conflicts" USING btree ("tenant_id","resolved_at","recorded_at");--> statement-breakpoint
CREATE INDEX "sync_operations_record_idx" ON "sync_operations" USING btree ("tenant_id","entity","record_id");--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "audit_chains" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_chains" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("audit_chains"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "audit_entries" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_entries" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("audit_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_accounts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_passkeys" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_rate_limits" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_sessions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_two_factors" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_users" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "auth_users" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "auth_verifications" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "instance_changes" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "instance_changes" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "instance_operators" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "outside_any_tenant" ON "instance_settings" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') is null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("invitations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invitations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "invitations" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_passkeys" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("member_passkeys"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("member_passkeys"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("memberships"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("memberships"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "own_membership_outside_tenant" ON "memberships" AS PERMISSIVE FOR SELECT TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null
        and "memberships"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "memberships" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_sessions" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenant_sessions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_sessions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_conflicts" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("sync_conflicts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sync_conflicts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_operations" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("sync_operations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sync_operations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "written_by_trigger" ON "sync_sequences" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_sequences" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("sync_sequences"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_roles" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenant_roles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_roles"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "tenant_roles" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("tenants"."id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenants"."id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "own_tenants_outside_tenant" ON "tenants" AS PERMISSIVE FOR SELECT TO "opengewerk_app" USING (nullif(current_setting('app.tenant_id', true), '') is null
      and exists (
        select 1 from memberships m
         where m.tenant_id = "tenants"."id"
           and m.user_id = nullif(current_setting('app.user_id', true), '')
      ));--> statement-breakpoint
CREATE POLICY "created_by_setup" ON "tenants" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "no_application_insert" ON "tenants" AS RESTRICTIVE FOR INSERT TO "opengewerk_app" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "readable_by_the_owner" ON "tenants" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "number_ranges" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("number_ranges"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("number_ranges"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "secrets" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("secrets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("secrets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Part 3 of 5: FORCE, and what the application role may do with each table.
--
-- drizzle-kit switches row level security on wherever a table has a policy.
-- FORCE is what makes the policies apply to the owner of the tables as well,
-- and without a grant the role does not see a table at all. The rights are
-- given table by table and never for the schema as a whole: a table added
-- later starts with none.

ALTER TABLE "audit_chains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "audit_chains" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "audit_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "audit_entries" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_accounts" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_passkeys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_passkeys" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_rate_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_rate_limits" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_sessions" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_two_factors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_two_factors" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "auth_users" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "auth_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_verifications" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "instance_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "instance_changes" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "instance_operators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "instance_operators" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "instance_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, UPDATE ON "instance_settings" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "invitations" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "member_passkeys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "member_passkeys" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "memberships" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "tenant_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_sessions" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sync_conflicts" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "sync_operations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "sync_operations" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "sync_sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "sync_sequences" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "tenant_roles" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "tenants" TO "opengewerk_app";--> statement-breakpoint
GRANT UPDATE ("name", "updated_at") ON "tenants" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "number_ranges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "number_ranges" TO "opengewerk_app";--> statement-breakpoint
ALTER TABLE "secrets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "secrets" TO "opengewerk_app";--> statement-breakpoint

-- Part 4 of 5: the functions, and what a block brings with them.

-- The audit log: one entry per field that changed, written by a trigger and
-- chained by hash. The two tables come from the schema; what is in here is
-- everything drizzle-kit does not know.
--
-- Four decisions are in here.
--
-- 1. A trigger, not a line in the server. A change has to show up in the log
--    whichever way it arrives, a migration and a psql session included.
--    Anything the application would have to write itself catches nothing at
--    exactly the point where the application is bypassed.
-- 2. The trigger goes on every table of a tenant. Which tables those are is
--    said table by table where the migration grants the rights, and a test
--    asks the catalogue afterwards: a new table without the trigger turns it
--    red.
-- 3. The application role gets SELECT on the two audit tables and nothing
--    else. It can neither forge an entry nor remove one; the only writer is
--    the trigger, running as its definer.
-- 4. Every entry carries the hash of the one before it. Append only stops a
--    change from being made through the database; the chain notices one that
--    was made anyway, by whatever means, and says where.
--
-- What none of this reaches: a superuser can turn the trigger off, and no
-- arrangement inside a database prevents that. What the chain does is make the
-- result visible afterwards, which is a different and more modest promise.

-- What an entry is hashed over: itself, minus its own hash. Taking the whole
-- row instead of a list of columns means the same call writes an entry and
-- checks it afterwards. One definition, not two that drift apart.
--
-- It also means the columns of `audit_entries` are frozen. One more column
-- changes the text form of every entry that is already there, and a chain
-- that was sound reports a break at entry one. A test holds the list.
--
-- Both settings are pinned for a reason. pg_catalog first so nothing can be
-- slipped in front of a built in function; UTC because jsonb renders a
-- timestamp in the session time zone, so the very same entry would otherwise
-- hash differently in Berlin and in New York and a sound chain would look
-- broken abroad.
CREATE FUNCTION "audit_fingerprint"(entry public.audit_entries) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	SET search_path = pg_catalog, public
	SET "TimeZone" = 'UTC'
AS $$
	SELECT encode(sha256(convert_to((to_jsonb(entry) - 'hash')::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint

-- The writer. SECURITY DEFINER so that it reaches the log even when the role
-- that triggered it may not write there, which is precisely the case worth
-- having: otherwise the log would only be as complete as the rights of whoever
-- wants to get around it.
--
-- Every table carries its tenant in `tenant_id`. The one exception is
-- `tenants` itself, where the row's own id is the tenant. A table with neither
-- makes the insert fail on NOT NULL, and that is the right direction: loud
-- while migrating beats silent in the log.
--
-- The chain row is created on first use and locked either way. ON CONFLICT DO
-- UPDATE rather than DO NOTHING on purpose: DO NOTHING would let a second
-- transaction fall through without seeing the row the first one has not
-- committed yet, and the chain would fork.
--
-- One row per field that genuinely differs, compared over the text form from
-- to_jsonb rather than over a list of columns, and written one at a time in a
-- fixed order, because each hash covers the one before it and the same change
-- has to produce the same chain.
--
-- Four columns stay out. All four move on every single write and say nothing
-- the entry does not already say better: `updated_at`, `updated_by`, `version`
-- and `change_sequence`. `device_id` and `deleted_at` stay in. Nothing else
-- records which device a change came from, and marking a record as deleted is
-- a change like any other, in fact the one somebody is most likely to ask
-- about later.
CREATE FUNCTION "record_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_row jsonb := '{}'::jsonb;
	after_row jsonb := '{}'::jsonb;
	present jsonb;
	chain public.audit_chains;
	entry public.audit_entries;
	place bigint;
	previous text;
	changed text;
BEGIN
	IF tg_op <> 'INSERT' THEN
		before_row := to_jsonb(old);
	END IF;

	IF tg_op <> 'DELETE' THEN
		after_row := to_jsonb(new);
	END IF;

	present := CASE WHEN tg_op = 'DELETE' THEN before_row ELSE after_row END;

	entry.tenant_id := coalesce(present ->> 'tenant_id', present ->> 'id')::uuid;
	entry.record_id := (present ->> 'id')::uuid;
	entry.change_id := uuidv7();
	entry.table_name := tg_table_name;
	entry.operation := lower(tg_op)::public.audit_operation;
	entry.changed_at := now();
	entry.user_id := nullif(current_setting('app.user_id', true), '');
	entry.reason := nullif(current_setting('app.reason', true), '');
	entry.database_role := session_user;

	INSERT INTO public.audit_chains (tenant_id)
	VALUES (entry.tenant_id)
	ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
	RETURNING * INTO chain;

	place := chain.next_sequence;
	previous := chain.head_hash;

	FOR changed IN
		SELECT k.field
		  FROM jsonb_object_keys(before_row || after_row) AS k(field)
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence']))
		   AND (before_row ->> k.field) IS DISTINCT FROM (after_row ->> k.field)
		 ORDER BY k.field
	LOOP
		entry.id := uuidv7();
		entry.sequence := place;
		entry.previous_hash := previous;
		entry.field := changed;
		entry.old_value := before_row ->> changed;
		entry.new_value := after_row ->> changed;
		entry.hash := public.audit_fingerprint(entry);

		INSERT INTO public.audit_entries VALUES (entry.*);

		previous := entry.hash;
		place := place + 1;
	END LOOP;

	IF place <> chain.next_sequence THEN
		UPDATE public.audit_chains
		   SET next_sequence = place, head_hash = previous, updated_at = now()
		 WHERE tenant_id = entry.tenant_id;
	END IF;

	RETURN NULL;
END;
$$;--> statement-breakpoint

-- Walks a tenant's chain and reports the first place that does not fit. Not
-- SECURITY DEFINER: run by the application it sees its own tenant and nothing
-- else, which is the right way round for a check a tenant runs on itself.
--
-- It calls the same fingerprint the writer used, so the two cannot disagree
-- about what was hashed.
CREATE FUNCTION "verify_audit_chain"(tenant uuid)
	RETURNS TABLE (checked bigint, broken_at bigint, problem text)
	LANGUAGE plpgsql
	STABLE
	SET search_path = pg_catalog, public
AS $$
DECLARE
	entry public.audit_entries;
	expected bigint := 1;
	previous text := NULL;
BEGIN
	checked := 0;
	broken_at := NULL;
	problem := NULL;

	FOR entry IN
		SELECT * FROM public.audit_entries e
		 WHERE e.tenant_id = tenant
		 ORDER BY e.sequence
	LOOP
		IF entry.sequence <> expected THEN
			broken_at := expected;
			problem := format('Eintrag %s fehlt, der nächste trägt die Nummer %s.',
				expected, entry.sequence);
			RETURN NEXT;
			RETURN;
		END IF;

		IF entry.previous_hash IS DISTINCT FROM previous THEN
			broken_at := entry.sequence;
			problem := 'Der Eintrag verweist nicht auf seinen Vorgänger.';
			RETURN NEXT;
			RETURN;
		END IF;

		IF entry.hash IS DISTINCT FROM public.audit_fingerprint(entry) THEN
			broken_at := entry.sequence;
			problem := 'Der Eintrag wurde nachträglich verändert.';
			RETURN NEXT;
			RETURN;
		END IF;

		checked := checked + 1;
		previous := entry.hash;
		expected := expected + 1;
	END LOOP;

	RETURN NEXT;
END;
$$;--> statement-breakpoint

-- And the bolt in front of it. An entry is written once and not touched again.
-- TRUNCATE needs a trigger of its own, because it never touches the rows one
-- by one and a row trigger therefore never fires. Without it the whole log
-- would be one statement away.
--
-- The chain table has no such bolt and needs none: rewinding its counter makes
-- the next entry collide on a number already taken, and putting a different
-- head in breaks the chain at the following entry. Both are found by the
-- check, which is what the chain is for.
CREATE FUNCTION "audit_entry_stays"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Das Audit-Log wird nur ergänzt. Ein Eintrag wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG002';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "audit_entries_stay"
	BEFORE UPDATE OR DELETE ON "audit_entries"
	FOR EACH ROW EXECUTE FUNCTION "audit_entry_stays"();--> statement-breakpoint

CREATE TRIGGER "audit_entries_stay_on_truncate"
	BEFORE TRUNCATE ON "audit_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_entry_stays"();--> statement-breakpoint

-- The offline data layer: what keeps a record true while it is changed in two
-- places at once. The three tables come from the schema, and so do the five
-- columns a travelling record carries; in here is what fills them.
--
-- All of it is kept by a trigger rather than by whoever writes the row. A line
-- the application has to remember is a line it forgets at the sixteenth place,
-- and here it would forget it invisibly: a stale version only hurts the next
-- time two devices meet, which is days later and somewhere else.
--
-- 1. `version`, `updated_by`, `device_id`: who changed the row, from where,
--    and how often it has changed at all.
-- 2. `change_sequence`: where the change sits in the tenant's stream. It comes
--    from one counter row per tenant, so the numbers come out in the order the
--    transactions commit. A cursor on timestamps instead would quietly skip a
--    row whose transaction started early and committed late, and the device
--    would never hear about that row again.
-- 3. `deleted_at`: a row is marked, not removed. A removed row is a row a
--    device that was offline never learns about, because a delta pull delivers
--    what changed and a row that is gone is not among it.

-- The counter. SECURITY DEFINER because the application role has no business
-- writing here and does not have the grant for it; the number is handed out,
-- not asked for.
--
-- ON CONFLICT DO UPDATE rather than DO NOTHING, for the same reason as in the
-- audit chain: DO NOTHING would let a second transaction fall through without
-- seeing the row the first one has not committed yet.
CREATE FUNCTION "next_sync_sequence"(tenant uuid) RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	assigned bigint;
BEGIN
	INSERT INTO public.sync_sequences (tenant_id)
	VALUES (tenant)
	ON CONFLICT (tenant_id) DO UPDATE SET next_value = sync_sequences.next_value + 1,
		updated_at = now()
	RETURNING next_value INTO assigned;

	RETURN assigned;
END;
$$;--> statement-breakpoint

-- What keeps the five columns true. It does not touch a table, so it runs as
-- whoever triggered it; the counter it calls is the part that needs more.
--
-- The trigger that calls it goes on every table that carries the columns, and
-- its name matters. PostgreSQL fires BEFORE triggers in alphabetical order, so
-- `stamp_sync_columns` runs after a trigger named for its table, and a check
-- that guards a fixed record sees the row as the caller sent it.
CREATE FUNCTION "stamp_sync_columns"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	new.updated_at := now();
	new.updated_by := nullif(current_setting('app.user_id', true), '');
	new.device_id := nullif(current_setting('app.device_id', true), '');
	new.version := CASE WHEN tg_op = 'UPDATE' THEN old.version + 1 ELSE 1 END;
	new.change_sequence := public.next_sync_sequence(new.tenant_id);

	RETURN new;
END;
$$;--> statement-breakpoint

-- The four questions that have to be asked outside any tenant, and the one
-- way a first tenant comes to be. The policies they pass come from the schema;
-- the functions and who may call them are in here.
--
-- Each of them runs as the owner of the tables, for one statement, because the
-- caller cannot see what it asks about: outside a tenant the application reads
-- the tenants of its own memberships and nothing else, and at these moments
-- there is no membership, or nobody signed in at all. `FORCE ROW LEVEL
-- SECURITY` applies to the owner as well, which is why the tables they read
-- carry `readable_by_the_owner`, and why `tenants` carries `created_by_setup`
-- next to the restrictive policy that keeps the application from inserting.

-- Whether this instance has never been used.
--
-- Both halves are needed. No tenant and no account is the state a fresh
-- installation is in; either one on its own would leave the setup open next to
-- data that is already there.
--
-- STABLE, so it reads the snapshot of the statement that calls it rather than
-- one of its own. That is what makes it answer correctly inside
-- `create_first_tenant`, where the statement before it waited on a lock.
CREATE FUNCTION "instance_is_empty"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT NOT EXISTS (SELECT 1 FROM public.tenants)
	   AND NOT EXISTS (SELECT 1 FROM public.auth_users)
$$;--> statement-breakpoint

-- The one tenant a first run creates, and the only way the application ever
-- creates one unasked. The application role has no INSERT on `tenants`.
--
-- The lock is why this is a function and not a check in the application. Two
-- people opening the setup screen at the same moment would both be told the
-- instance is empty, and both would create a tenant. The advisory lock is held
-- until the transaction ends, whether it commits or rolls back, so the second
-- one asks after the first has committed and finds the tenant. Read committed
-- is what makes that work: the statement after the lock takes a fresh
-- snapshot. The key is arbitrary and only has to be unique in this database.
--
-- The id is minted here rather than read back with RETURNING. RETURNING reads
-- the new row back, so it asks the SELECT policies as well as the WITH CHECK,
-- and the refusal for either says the same sentence.
CREATE FUNCTION "create_first_tenant"(company text) RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	created uuid;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext('opengewerk.first_run_setup'));

	IF NOT public.instance_is_empty() THEN
		RAISE EXCEPTION 'Diese Instanz ist bereits eingerichtet.'
			USING ERRCODE = 'OG003';
	END IF;

	created := uuidv7();

	INSERT INTO public.tenants (id, name) VALUES (created, company);

	RETURN created;
END;
$$;--> statement-breakpoint

-- The one invitation a token names, and the tenant it belongs to.
--
-- A redemption arrives without a session, so no tenant is set and the ordinary
-- policy on `invitations` matches no row: the caller cannot even find the
-- invitation that was made for them. The token is what names the tenant, and
-- the token can only be looked up by something that sees the table whole.
--
-- A set rather than a single row, so that an unknown token comes back as no
-- rows instead of a row of nulls a caller has to tell apart from a real one.
-- It returns the row as it stands, used, called back and expired ones
-- included, and the application decides what to say about each: sentences are
-- read by a person and belong where the rest of the wording is.
--
-- It cannot be turned into a way of listing invitations or tenants: the only
-- way in is a token whose hash matches, and the hash of 32 random bytes is not
-- something to guess at.
CREATE FUNCTION "invitation_for"(hash text)
	RETURNS TABLE (
		invitation_id uuid,
		business uuid,
		company text,
		invited_email text,
		invited_name text,
		invited_roles text[],
		expires timestamp with time zone,
		redeemed timestamp with time zone,
		revoked timestamp with time zone
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT i.id, i.tenant_id, t.name, i.email, i.name, i.roles,
	       i.expires_at, i.redeemed_at, i.revoked_at
	  FROM public.invitations i
	  JOIN public.tenants t ON t.id = i.tenant_id
	 WHERE i.token_hash = hash
$$;--> statement-breakpoint

-- The tenants of this instance, by identifier and nothing else.
--
-- The jobs that run in the background work for all of them and act for no
-- person, so they have no membership to find them through. Every read after
-- this one runs inside a tenant like any other, so the isolation of the data
-- is where it was.
CREATE FUNCTION "every_tenant"() RETURNS SETOF uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT id FROM public.tenants ORDER BY id
$$;--> statement-breakpoint

-- EXECUTE belongs to everybody by default, which for these four would mean
-- every role in the cluster. Taken away first and given back to the one role
-- that calls them, so that a role added later for something else does not
-- inherit a way past the isolation.
REVOKE EXECUTE ON FUNCTION "instance_is_empty"() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "create_first_tenant"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "invitation_for"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "every_tenant"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "instance_is_empty"() TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "create_first_tenant"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "invitation_for"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "every_tenant"() TO "opengewerk_app";--> statement-breakpoint

-- The area of the instance: what belongs to the instance and to no tenant.
-- The log of who runs it and what holds for every tenant on it, the one way a
-- further tenant comes to be, and the tenants as whoever runs the instance
-- sees them. The tables and their policies come from the schema; the
-- functions, the triggers, the one row of settings and who may call what are
-- in here.
--
-- **Why a log of its own.** The log of a tenant needs a tenant: its trigger
-- takes the tenant from the row and writes it into a column that cannot be
-- null. These tables have none, so they get `record_instance_change`, the same
-- trigger without a tenant and without the chain, writing into
-- `instance_changes`. It also watches `tenants` for a tenant being created or
-- removed, which is something that happens to the instance; a new name is the
-- tenant's own affair and stays in its log.

-- The log of the instance is only ever added to, like the log of a tenant,
-- and TRUNCATE needs a trigger of its own because it never touches a row.
CREATE FUNCTION "instance_change_stays"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Das Protokoll der Instanz wird nur ergänzt. Ein Eintrag wird weder geändert noch gelöscht.'
		USING ERRCODE = 'OG002';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "instance_changes_stay"
	BEFORE UPDATE OR DELETE ON "instance_changes"
	FOR EACH ROW EXECUTE FUNCTION "instance_change_stays"();--> statement-breakpoint

CREATE TRIGGER "instance_changes_stay_on_truncate"
	BEFORE TRUNCATE ON "instance_changes"
	FOR EACH STATEMENT EXECUTE FUNCTION "instance_change_stays"();--> statement-breakpoint

-- The writer of the log of the instance: one row per field that differs, the
-- fields of one write sharing a change id, as `record_change` writes the log
-- of a tenant. SECURITY DEFINER so that it reaches the log whoever made the
-- change, and the same four columns stay out of the comparison.
CREATE FUNCTION "record_instance_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	before_row jsonb := '{}'::jsonb;
	after_row jsonb := '{}'::jsonb;
	present jsonb;
	change uuid := uuidv7();
	changed text;
BEGIN
	IF tg_op <> 'INSERT' THEN
		before_row := to_jsonb(old);
	END IF;

	IF tg_op <> 'DELETE' THEN
		after_row := to_jsonb(new);
	END IF;

	present := CASE WHEN tg_op = 'DELETE' THEN before_row ELSE after_row END;

	FOR changed IN
		SELECT k.field
		  FROM jsonb_object_keys(before_row || after_row) AS k(field)
		 WHERE NOT (k.field = ANY (ARRAY['updated_at', 'updated_by', 'version', 'change_sequence']))
		   AND (before_row ->> k.field) IS DISTINCT FROM (after_row ->> k.field)
		 ORDER BY k.field
	LOOP
		INSERT INTO public.instance_changes (change_id, table_name, record_id, operation, field,
			old_value, new_value, user_id, reason, database_role)
		VALUES (change, tg_table_name, present ->> 'id', lower(tg_op)::public.audit_operation, changed,
			before_row ->> changed, after_row ->> changed,
			nullif(current_setting('app.user_id', true), ''),
			nullif(current_setting('app.reason', true), ''),
			session_user);
	END LOOP;

	RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "instance_changes" AFTER INSERT OR UPDATE OR DELETE ON "instance_operators"
	FOR EACH ROW EXECUTE FUNCTION "record_instance_change"();--> statement-breakpoint
CREATE TRIGGER "instance_changes" AFTER INSERT OR UPDATE OR DELETE ON "instance_settings"
	FOR EACH ROW EXECUTE FUNCTION "record_instance_change"();--> statement-breakpoint
CREATE TRIGGER "instance_changes" AFTER INSERT OR DELETE ON "tenants"
	FOR EACH ROW EXECUTE FUNCTION "record_instance_change"();--> statement-breakpoint

-- The one row of settings, with the defaults: no mail server in the own
-- network, the backup at half past two. Written here because nothing else may:
-- the application role updates the row and never inserts one.
--
-- `FORCE` is off for the moment of the insert. This runs as the owner, no
-- policy names the owner, and under `FORCE` the insert would be refused. The
-- trigger above is already in place, so the row stands in the log of the
-- instance as written by a migration.
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
ALTER TABLE "instance_settings" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "instance_settings" ("id") VALUES (1);--> statement-breakpoint
ALTER TABLE "instance_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint

-- A further tenant, and besides the first run the only way the application
-- creates one: it has no INSERT on `tenants`. Who may call this, somebody who
-- leads a tenant for themselves and whoever runs the instance for somebody
-- else, the server decides. What makes somebody lead the new tenant is
-- written after it, inside the new tenant, in the same transaction, so that it
-- lands in that tenant's log.
--
-- The name is checked here as well as in the server, so that no other way in
-- creates a tenant without one. What a name has to be beyond that is the rule
-- of the application, asked before this is called and in its words; the
-- sentence here is the last line behind it and calls a tenant nothing.
CREATE FUNCTION "create_tenant"(company text) RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
DECLARE
	created uuid;
BEGIN
	IF company IS NULL OR length(btrim(company)) = 0 OR length(btrim(company)) > 120 THEN
		RAISE EXCEPTION 'Der Name fehlt oder ist länger als 120 Zeichen.'
			USING ERRCODE = 'OG003';
	END IF;

	created := uuidv7();

	INSERT INTO public.tenants (id, name) VALUES (created, btrim(company));

	RETURN created;
END;
$$;--> statement-breakpoint

-- The tenants of the instance as whoever runs it sees them: the name, the day
-- it was created, who leads it and can still get in, how many people work in
-- it, and who is invited to lead it. Nothing of what is in a tenant.
--
-- Who leads is read from the roles of the tenant and not from the name of a
-- role: a membership or an invitation counts when one of the roles it names is
-- a role of that tenant that leads. It runs as the owner of the tables, which
-- is why `tenant_roles` carries `readable_by_the_owner` like the tables beside
-- it.
CREATE FUNCTION "tenants_with_leads"()
	RETURNS TABLE (id uuid, name text, created_at timestamptz, leads text[], members bigint, invited_leads text[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.name, t.created_at,
	       coalesce((SELECT array_agg(m.user_id ORDER BY m.created_at) FROM public.memberships m
	                  WHERE m.tenant_id = t.id AND m.blocked_at IS NULL
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (m.roles))), '{}'),
	       (SELECT count(*) FROM public.memberships m WHERE m.tenant_id = t.id),
	       coalesce((SELECT array_agg(i.email ORDER BY i.created_at) FROM public.invitations i
	                  WHERE i.tenant_id = t.id
	                    AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (i.roles))), '{}')
	  FROM public.tenants t
	 ORDER BY t.created_at, t.name
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "create_tenant"(text) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "tenants_with_leads"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "create_tenant"(text) TO "opengewerk_app";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "tenants_with_leads"() TO "opengewerk_app";--> statement-breakpoint

-- Part 5 of 5: the triggers on the tables, which call the functions above.

CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "invitations"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "member_passkeys"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "memberships"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tenant_sessions"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tenant_roles"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "tenants"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "number_ranges"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
