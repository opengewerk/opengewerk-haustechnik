-- Takes back 0112_outside_counts: the limits of the page of a label are counted in the process again.
DROP FUNCTION "outside_take"(text[], text[], integer[], text[], timestamp with time zone);--> statement-breakpoint
DROP TABLE "outside_counts";
