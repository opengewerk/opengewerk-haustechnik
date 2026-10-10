-- A plan of a round can leave out the statutory public holidays of the state
-- of its property (#200, sections 2.9 and 4.5 of the concept): a pass on a
-- holiday is then left out and not moved, like one in a closure of its
-- building. Which days are holidays is said by the rules of the catalogue,
-- not by the database; a plan made before keeps counting a holiday like any
-- day.

ALTER TABLE "round_plans" ADD COLUMN "skip_holidays" boolean DEFAULT false NOT NULL;
