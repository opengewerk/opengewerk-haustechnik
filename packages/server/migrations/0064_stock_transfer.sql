-- The transfer of an article to another store (#391, the addendum of
-- 16.10.2026 to ADR 0011 in the repository opengewerk): two bookings of the
-- kinds `transfer_out` and `transfer_in`, each naming the other store in
-- `counterpart_store_id`. The building block of the foundation brings the
-- column, its key and two checks, and `stock_movements_kind_known` takes the
-- two kinds; this is the same change for the tables of this application.
--
-- Bookings are written once, and adding a column writes none. The key onto
-- the stores is added with `FORCE ROW LEVEL SECURITY` lifted on both tables
-- for its length: both hold rows, and under `FORCE` PostgreSQL would check
-- the key only against what their policies show the owner (#315).
--
-- **Fits the version before it.** That version writes neither kind and no
-- other store; every booking it writes holds every check.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_known";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "counterpart_store_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_with_a_store_here" FOREIGN KEY ("tenant_id","counterpart_store_id") REFERENCES "public"."stores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_names_its_store" CHECK (("stock_movements"."kind" in ('transfer_out', 'transfer_in')) = ("stock_movements"."counterpart_store_id" is not null));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_elsewhere" CHECK ("stock_movements"."counterpart_store_id" is null or "stock_movements"."counterpart_store_id" <> "stock_movements"."store_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_known" CHECK ("stock_movements"."kind" in ('receipt', 'count', 'withdrawal', 'transfer_out', 'transfer_in'));