-- Takes the write-off out again, back to how 0081 left things. Run as the
-- superuser, like every rollback. It fails while a write-off is booked, as it
-- should: a booking is never removed to take a kind away.
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_write_off_with_a_reason";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_kind_known";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_known" CHECK ("stock_movements"."kind" in ('receipt', 'count', 'withdrawal', 'transfer_out', 'transfer_in'));
