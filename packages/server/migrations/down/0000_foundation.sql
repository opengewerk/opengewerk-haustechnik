-- The rollback for the initial migration: back to an empty database.
--
-- The functions and triggers first, in the opposite order to the one they
-- were created in, then the tables.

-- Takes the block `instance.sql` back out: the functions and the triggers. The
-- tables go with the schema, and the row of settings and the log with them.
DROP FUNCTION IF EXISTS "tenants_with_leads"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "create_tenant"(text);--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes" ON "tenants";--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes" ON "instance_settings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes" ON "instance_operators";--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_instance_change"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes_stay_on_truncate" ON "instance_changes";--> statement-breakpoint
DROP TRIGGER IF EXISTS "instance_changes_stay" ON "instance_changes";--> statement-breakpoint
DROP FUNCTION IF EXISTS "instance_change_stays"();--> statement-breakpoint

-- Takes the block `setup.sql` back out. A tenant and an account that were
-- created through it stay: this undoes the way in, not what somebody did with
-- it.
DROP FUNCTION IF EXISTS "every_tenant"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "invitation_for"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "create_first_tenant"(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS "instance_is_empty"();--> statement-breakpoint

-- Takes the block `sync.sql` back out. The trigger goes wherever it hangs, not
-- wherever a list claims it does: the catalogue is asked, the same way round
-- as a test asks it.
DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_trigger t
		  JOIN pg_class c ON c.oid = t.tgrelid
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public'
		   AND t.tgname = 'stamp_sync_columns'
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS "stamp_sync_columns" ON %I', target);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "stamp_sync_columns"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "next_sync_sequence"(uuid);--> statement-breakpoint

-- Takes the block `audit.sql` back out, before the tables it stands on.
DROP TRIGGER IF EXISTS "audit_entries_stay_on_truncate" ON "audit_entries";--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_entries_stay" ON "audit_entries";--> statement-breakpoint
DROP FUNCTION IF EXISTS "audit_entry_stays"();--> statement-breakpoint

-- The same question to the catalogue as for the sync columns: the trigger
-- goes wherever it hangs.
DO $$
DECLARE
	target text;
BEGIN
	FOR target IN
		SELECT c.relname
		  FROM pg_trigger t
		  JOIN pg_class c ON c.oid = t.tgrelid
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public'
		   AND t.tgname = 'audit_changes'
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS "audit_changes" ON %I', target);
	END LOOP;
END
$$;--> statement-breakpoint
DROP FUNCTION IF EXISTS "verify_audit_chain"(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS "record_change"();--> statement-breakpoint

-- Before the table, not after it. The fingerprint takes a row of audit_entries
-- as its argument, so the table type is part of its signature and PostgreSQL
-- refuses to drop the table while it exists.
DROP FUNCTION IF EXISTS "audit_fingerprint"(public.audit_entries);--> statement-breakpoint

-- The policies before the tables. One of them reads another table, the
-- chooser on `tenants` reads the memberships, and a table a policy still
-- reads cannot be dropped.
DROP POLICY IF EXISTS "written_by_trigger" ON "audit_chains";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "audit_chains";--> statement-breakpoint
DROP POLICY IF EXISTS "written_by_trigger" ON "audit_entries";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "audit_entries";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_accounts";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_passkeys";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_rate_limits";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_two_factors";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_users";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "auth_users";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_verifications";--> statement-breakpoint
DROP POLICY IF EXISTS "written_by_trigger" ON "instance_changes";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "instance_changes";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "instance_operators";--> statement-breakpoint
DROP POLICY IF EXISTS "outside_any_tenant" ON "instance_settings";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invitations";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "invitations";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "member_passkeys";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";--> statement-breakpoint
DROP POLICY IF EXISTS "own_membership_outside_tenant" ON "memberships";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "memberships";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_sessions";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "sync_conflicts";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "sync_operations";--> statement-breakpoint
DROP POLICY IF EXISTS "written_by_trigger" ON "sync_sequences";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "sync_sequences";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_roles";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "tenant_roles";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "own_tenants_outside_tenant" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "created_by_setup" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "no_application_insert" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "readable_by_the_owner" ON "tenants";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "number_ranges";--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "secrets";--> statement-breakpoint

-- The tables, whatever points at a table before the table itself, and no
-- CASCADE: that would also clear away what somebody built next to them later,
-- and exactly that should be noticed instead of disappearing without a word.
DROP TABLE IF EXISTS "secrets";--> statement-breakpoint
DROP TABLE IF EXISTS "number_ranges";--> statement-breakpoint
DROP TABLE IF EXISTS "tenant_roles";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_sequences";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_operations";--> statement-breakpoint
DROP TABLE IF EXISTS "sync_conflicts";--> statement-breakpoint
DROP TABLE IF EXISTS "tenant_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "member_passkeys";--> statement-breakpoint
DROP TABLE IF EXISTS "memberships";--> statement-breakpoint
DROP TABLE IF EXISTS "invitations";--> statement-breakpoint
DROP TABLE IF EXISTS "instance_settings";--> statement-breakpoint
DROP TABLE IF EXISTS "instance_operators";--> statement-breakpoint
DROP TABLE IF EXISTS "instance_changes";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_verifications";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_two_factors";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_rate_limits";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_passkeys";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_accounts";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_users";--> statement-breakpoint
DROP TABLE IF EXISTS "audit_entries";--> statement-breakpoint
DROP TABLE IF EXISTS "audit_chains";--> statement-breakpoint
DROP TABLE IF EXISTS "tenants";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."secret_purpose";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."number_range_key";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."operation_outcome";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."conflict_reason";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."sign_in_method";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."audit_operation";--> statement-breakpoint

-- The way into the schema. The role itself stays: it belongs to the cluster
-- and may hold rights elsewhere.
REVOKE USAGE ON SCHEMA "public" FROM "opengewerk_app";--> statement-breakpoint

-- And the record of the runner, last: there is nothing left for it to describe.
DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations";--> statement-breakpoint
DROP SCHEMA IF EXISTS "drizzle";
