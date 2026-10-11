-- Rolling the two indexes of the device scope back to how 0037 left the
-- database.
--
-- What it costs an installation that runs it: nothing but time. Every answer
-- stays the same; a pull of a device that does not see every area reads all
-- activities again.

DROP INDEX "activities_changed_idx";--> statement-breakpoint
DROP INDEX "activities_open_idx";
