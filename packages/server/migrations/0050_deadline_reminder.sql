-- How a deadline of a kind reminds (#269), the setting of the foundation
-- beside lead, interval and who answers for it: by mail and by push, which is
-- what null means and what every kind did so far, by mail alone, or with no
-- message at all. The writers of the messages ask it for each channel; a
-- deadline set to no message stays in the list and still makes its task or
-- its work order. The same column as migration 0074 of OpenGewerk, which
-- carries the foundation as well.
--
-- Nothing is written and no row is touched. A version of the application from
-- before this one reads the rows as before and leaves the column alone.

ALTER TABLE "deadline_settings" ADD COLUMN "reminder" text;--> statement-breakpoint
ALTER TABLE "deadline_settings" ADD CONSTRAINT "deadline_settings_reminder_known" CHECK ("deadline_settings"."reminder" is null or "deadline_settings"."reminder" in ('email_and_push', 'email', 'none'));
