ALTER TABLE "duties" ADD COLUMN "guide_days" integer;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "guide_months" integer;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "kept_version" integer;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "kept_days" integer;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "kept_months" integer;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "kept_reason" text;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_guide_one_unit" CHECK ("duties"."guide_days" is null or "duties"."guide_months" is null);--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_guide_in_bounds" CHECK (("duties"."guide_days" is null or "duties"."guide_days" >= 1)
      and ("duties"."guide_months" is null or "duties"."guide_months" >= 1));--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_maximum_or_guide" CHECK (num_nonnulls("duties"."maximum_days", "duties"."maximum_months") = 0
        or num_nonnulls("duties"."guide_days", "duties"."guide_months") = 0);--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_kept_whole" CHECK (("duties"."kept_version" is null) = ("duties"."kept_reason" is null)
        and ("duties"."kept_version" is not null or num_nonnulls("duties"."kept_days", "duties"."kept_months") = 0));--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_kept_from_the_catalogue" CHECK ("duties"."kept_version" is null or "duties"."kind" is not null);--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_kept_version_shaped" CHECK ("duties"."kept_version" is null or "duties"."kept_version" >= 1);--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_kept_one_unit" CHECK ("duties"."kept_days" is null or "duties"."kept_months" is null);--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_kept_in_bounds" CHECK (("duties"."kept_days" is null or "duties"."kept_days" >= 1)
      and ("duties"."kept_months" is null or "duties"."kept_months" >= 1));--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_kept_reason_shaped" CHECK ("duties"."kept_reason" is null or ("duties"."kept_reason" = btrim("duties"."kept_reason") and char_length("duties"."kept_reason") between 1 and 500));