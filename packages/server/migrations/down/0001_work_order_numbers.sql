-- Rolling the sequence for work orders back to how 0000 left the type.
--
-- What it costs an installation that runs it: the counter of the work orders
-- goes, with the pattern and the next number a tenant set for it. The numbers
-- work orders already carry stay where they stand; the version before neither
-- shows them nor hands out new ones.
--
-- PostgreSQL does not take a value out of an enum, so the type is made anew
-- without it. The rows go first, while the type still knows every value. The
-- reason travels with the statement that removes them, in one transaction, so
-- that the log of each tenant says why a counter disappeared.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "number_ranges" WHERE "key" = 'work_order';--> statement-breakpoint
ALTER TABLE "number_ranges" ALTER COLUMN "key" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."number_range_key";--> statement-breakpoint
CREATE TYPE "public"."number_range_key" AS ENUM('asset', 'evidence');--> statement-breakpoint
ALTER TABLE "number_ranges" ALTER COLUMN "key" SET DATA TYPE "public"."number_range_key" USING "key"::"public"."number_range_key";
