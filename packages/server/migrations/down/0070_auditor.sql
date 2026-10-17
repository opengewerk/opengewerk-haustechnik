-- Takes the auditor out again, back to how 0069 left things.
--
-- The role goes from every tenant, and with it the role of every membership
-- that held it: those memberships keep no role this version knows. The
-- policies go before the functions they call, then the tables, and with them
-- every limit and every line of the log of reads. Run as the superuser, like
-- every rollback.
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DELETE FROM "tenant_roles" WHERE "key" = 'auditor';--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "attachments";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "evidence_voidings";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "evidence";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "activity_duties";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "activities";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "duties";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "assets";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "rooms";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "floors";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "buildings";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "properties";--> statement-breakpoint
DROP FUNCTION IF EXISTS "session_limit_asset_kinds"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "session_limit_properties"();--> statement-breakpoint
DROP TABLE IF EXISTS "auditor_reads";--> statement-breakpoint
DROP TABLE IF EXISTS "invitation_limit_asset_kinds";--> statement-breakpoint
DROP TABLE IF EXISTS "invitation_limit_properties";--> statement-breakpoint
DROP TABLE IF EXISTS "member_limit_asset_kinds";--> statement-breakpoint
DROP TABLE IF EXISTS "member_limit_properties";
