-- Takes the duties that fall due once out again, back to how 0082 left things.
-- Run as the superuser, like every rollback. It fails while a duty falls due
-- once, as it should: a confirmed duty is never removed to take a kind away.
-- The value "once" stays in the enum; PostgreSQL removes no value from one,
-- and no row names it any more.
ALTER TABLE "duties" DROP CONSTRAINT IF EXISTS "duties_counted_from_once";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT IF EXISTS "duties_due_day_once";--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT IF EXISTS "duties_interval_one_unit";--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_interval_one_unit" CHECK (("duties"."interval_days" is null) <> ("duties"."interval_months" is null));--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN IF EXISTS "counted_from";--> statement-breakpoint
ALTER TABLE "duties" DROP COLUMN IF EXISTS "due_on";
