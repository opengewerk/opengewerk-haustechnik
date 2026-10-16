-- The basic measures of maintenance after DIN 31051 (#333, section 4.4 of
-- the concept): maintenance, inspection, repair and improvement.
--
-- A work order of another kind chooses its basic measure, which
-- `work_orders.measure` keeps; every other activity and work order follows
-- from its kind (decided 15.10.2026), which the application works out, so
-- that nothing has to be kept twice. A work order of another kind made
-- before keeps none and says so until it is changed.

CREATE TYPE "public"."basic_measure" AS ENUM('maintenance', 'inspection', 'repair', 'improvement');--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "measure" "basic_measure";--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_measure_of_another_kind" CHECK ("work_orders"."measure" is null or "work_orders"."kind" = 'other');
