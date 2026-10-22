-- Takes back 0109_briefing_page: a briefing no longer names the page the person saw.
DROP TRIGGER "briefings_name_their_page" ON "briefings";--> statement-breakpoint
DROP FUNCTION "briefing_names_its_page"();--> statement-breakpoint
ALTER TABLE "briefings" DROP CONSTRAINT "briefings_page_fingerprint_shaped";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "page_fingerprint";
