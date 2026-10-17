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
DROP POLICY IF EXISTS "within_limits" ON "deadlines";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "fault_reports";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "fault_report_contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "round_records";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "prints";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "labels";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "work_order_materials";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "work_permits";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "briefings";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "service_reports";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "service_report_records";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "work_order_decisions";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "activity_signatures";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "defects";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "round_plans";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "activity_answers";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "work_orders";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "work_order_participants";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "work_order_notes";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "duty_dismissals";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "meter_readings";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "meter_points";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "meter_pauses";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "meter_exchanges";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "asset_supplies";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "asset_lifecycle";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "contract_items";--> statement-breakpoint
DROP POLICY IF EXISTS "within_limits" ON "building_closures";--> statement-breakpoint
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
