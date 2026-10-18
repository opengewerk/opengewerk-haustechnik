-- Duties that fall due once (#439): the counting "once", the due day of such a
-- duty and the day of its asset it is counted from. The checks compare the
-- counting as text, because a value added to an enum cannot be named as one
-- in the transaction that adds it. Every duty there is recurs and keeps its
-- interval; the new columns stay empty for it.
ALTER TYPE "public"."duty_counting" ADD VALUE 'once';--> statement-breakpoint
ALTER TABLE "duties" DROP CONSTRAINT "duties_interval_one_unit";--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "counted_from" date;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_due_day_once" CHECK (("duties"."counting"::text = 'once') = ("duties"."due_on" is not null));--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_counted_from_once" CHECK ("duties"."counted_from" is null
        or ("duties"."counting"::text = 'once' and "duties"."counted_from" <= "duties"."due_on"));--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_interval_one_unit" CHECK (case when "duties"."counting"::text = 'once'
        then "duties"."interval_days" is null and "duties"."interval_months" is null
        else ("duties"."interval_days" is null) <> ("duties"."interval_months" is null) end);