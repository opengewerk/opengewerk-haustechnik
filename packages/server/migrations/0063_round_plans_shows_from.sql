-- From which day a round of a plan shows on site (#394, section 4.5 of the
-- concept): a weekly plan from a day of its week, a monthly one from a day of
-- its month, a yearly one from a day and month of its year. The round stands
-- under "Start" from then until it is signed, and is made by then.
--
-- Two columns that may stay empty: empty is the first day, Monday, the 1st or
-- the 1st of January. So every plan there is already shows its rounds from
-- the start of their week, month or year without a row being written, and a
-- daily plan keeps its lead in days.
--
-- **Fits the version before it.** That version writes neither column and
-- reads neither; the check holds for every row it writes. A lead it writes
-- for a weekly, monthly or yearly plan stays, and this version leaves it
-- aside.
ALTER TABLE "round_plans" ADD COLUMN "shows_from_day" smallint;--> statement-breakpoint
ALTER TABLE "round_plans" ADD COLUMN "shows_from_month" smallint;--> statement-breakpoint
ALTER TABLE "round_plans" ADD CONSTRAINT "round_plans_shows_from" CHECK (coalesce(case "round_plans"."rhythm"
        when 'daily' then "round_plans"."shows_from_day" is null and "round_plans"."shows_from_month" is null
        when 'weekly' then ("round_plans"."shows_from_day" is null or "round_plans"."shows_from_day" between 1 and 7) and "round_plans"."shows_from_month" is null
        when 'monthly' then ("round_plans"."shows_from_day" is null or "round_plans"."shows_from_day" between 1 and 31) and "round_plans"."shows_from_month" is null
        else ("round_plans"."shows_from_month" is null or "round_plans"."shows_from_month" between 1 and 12) and ("round_plans"."shows_from_day" is null or "round_plans"."shows_from_day" between 1 and (case when "round_plans"."shows_from_month" = 2 then 29 when "round_plans"."shows_from_month" in (4, 6, 9, 11) then 30 else 31 end))
      end, false));