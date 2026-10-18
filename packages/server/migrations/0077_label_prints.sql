-- The print a label of a sheet came with (#170): every label of one sheet
-- printed for a property shares it, so that the free labels of a lost sheet
-- can be blocked at once. Up to here a row bore only the moment it was made.
--
-- The labels of a sheet that hang on nothing yet get one print each, by the
-- moment they were made: a sheet is made in one statement, so its labels
-- share that moment, and no two sheets of a property do. A label of a sheet
-- that was given to an asset or a room since keeps none; the print matters
-- only while a label is free. Filling changes rows, so it runs with `FORCE
-- ROW LEVEL SECURITY` lifted for its length, as in 0051, and every row it
-- changes gets its entry in the log of its tenant with the reason
-- `migration`.
--
-- **Fits the version before it.** That version writes no `print_id`, and a
-- label it prints has none, as one printed for an asset has none.
ALTER TABLE "labels" ADD COLUMN "print_id" uuid;--> statement-breakpoint
ALTER TABLE "labels" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "labels" SET "print_id" = "prints"."print_id"
  FROM (SELECT "tenant_id", "property_id", "created_at", gen_random_uuid() AS "print_id"
          FROM "labels"
         WHERE num_nonnulls("asset_id", "room_id") = 0
         GROUP BY "tenant_id", "property_id", "created_at") AS "prints"
 WHERE "labels"."tenant_id" = "prints"."tenant_id"
   AND "labels"."property_id" = "prints"."property_id"
   AND "labels"."created_at" = "prints"."created_at"
   AND num_nonnulls("labels"."asset_id", "labels"."room_id") = 0;--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;
