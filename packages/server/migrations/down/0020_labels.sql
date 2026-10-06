-- Rolling the labels back to how 0019 left the database.
--
-- What it costs an installation that runs it: every label that was made, and
-- with it what every sticker on an asset and a door opens. The rows go with
-- the reason in the same statement, so that the log of each tenant says why
-- they disappeared, and dropping a table writes nothing in any log. The
-- triggers on the records a label hangs on go with their function, and the
-- function of the foundation goes last.

SELECT set_config('app.reason', 'migration', true);
DELETE FROM "labels";--> statement-breakpoint
DROP FUNCTION "label_state_in_tenant"(text);--> statement-breakpoint
DROP TRIGGER "labels_follow_deletion" ON "assets";--> statement-breakpoint
DROP TRIGGER "labels_follow_deletion" ON "rooms";--> statement-breakpoint
DROP TRIGGER "labels_follow_deletion" ON "properties";--> statement-breakpoint
DROP FUNCTION "mark_labels_below"();--> statement-breakpoint
DROP TABLE "labels";--> statement-breakpoint
DROP FUNCTION "keep_label_blocked"();
