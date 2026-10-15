-- Rolling material at a work order back to how 0054 left the database.
--
-- What it costs an installation that runs it: every withdrawal at a work
-- order with its booking in the store, and every label on a shelf. The
-- bookings of the stores refuse a removal, so the trigger steps aside while
-- the withdrawals leave them, and comes back afterwards.

ALTER TABLE "stock_movements" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" DISABLE TRIGGER "kept_as_written";--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
DELETE FROM "stock_movements" WHERE "material_id" IS NOT NULL;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE TRIGGER "kept_as_written";--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_a_withdrawal_books_a_material";--> statement-breakpoint
DROP INDEX "stock_movements_book_a_material_once";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "material_id";--> statement-breakpoint
DROP TABLE "store_labels";--> statement-breakpoint
DROP TABLE "work_order_materials";--> statement-breakpoint
DROP FUNCTION "material_kept_as_written"();
