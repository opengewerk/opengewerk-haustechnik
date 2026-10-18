-- A write-off (#430): the office takes stock away for something without a
-- work order and says why. The kinds of a booking and the check of its
-- reason come from the stock of the foundation (opengewerk#665); the rule
-- that a withdrawal books a material of a work order (0055) stays as it is.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_known";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_write_off_with_a_reason" CHECK ("stock_movements"."kind" <> 'write_off' or "stock_movements"."reason" is not null);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_known" CHECK ("stock_movements"."kind" in ('receipt', 'count', 'withdrawal', 'transfer_out', 'transfer_in', 'write_off'));