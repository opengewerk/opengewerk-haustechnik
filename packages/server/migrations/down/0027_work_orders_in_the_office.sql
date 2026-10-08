-- Rolling the work orders in the office back to how 0026 left the database.
--
-- What it costs an installation that runs it: the further people of every
-- work order, how urgent each order is, and which defect an order came of.
-- The orders stay, with their activities, and a defect keeps the order that
-- sets it right. Dropping a column or a table writes nothing in any log.

DROP TABLE "work_order_participants";--> statement-breakpoint
DROP INDEX "work_orders_origin_defect_idx";--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_from_a_defect_of_their_property";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "origin_defect_id";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "urgency";--> statement-breakpoint
DROP TYPE "public"."work_order_urgency";
