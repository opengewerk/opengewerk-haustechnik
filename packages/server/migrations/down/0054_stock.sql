-- Rolling the stores back to how 0053 left the database.
--
-- What it costs an installation that runs it: every article, supplier and
-- store, the minimums and every booking, and the two rights "Lager ansehen"
-- and "Lager führen" in the rows of the roles. The trigger refuses to empty
-- the bookings, so the tables go as they are.

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove(array_remove("rights", 'store.read'), 'store.write'),
       "updated_at" = now()
 WHERE 'store.read' = ANY ("rights") OR 'store.write' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "stock_movements";--> statement-breakpoint
DROP TABLE "store_articles";--> statement-breakpoint
DROP TABLE "stores";--> statement-breakpoint
DROP TABLE "suppliers";--> statement-breakpoint
DROP TABLE "articles";--> statement-breakpoint
DROP FUNCTION "booking_kept_as_written"();
