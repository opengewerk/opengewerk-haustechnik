-- Rolling the transfers back to how 0063 left the database.
--
-- What it costs an installation that runs it: every transfer booked since.
-- The bookings are written once and the trigger refuses to remove one, so the
-- rollback refuses as long as a transfer stands; the version before could
-- not read its stock.

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_known";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_transfer_elsewhere";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_transfer_names_its_store";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_transfer_with_a_store_here";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "counterpart_store_id";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_known" CHECK ("stock_movements"."kind" in ('receipt', 'count', 'withdrawal'));
