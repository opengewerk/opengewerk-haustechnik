-- Two partial indexes for what a device holds of the activities (#80, T14-3
-- of the review of phase 0; ADR 0006): the device of a person who does not
-- see every area holds the open activities and those changed in the last
-- thirty days, and `deviceScope` asks for them on every pull. Without an
-- index the database read every activity of the operator, the closed ones of
-- all the years before included, and the time grew with the years an
-- installation runs. Each index carries one half of the condition of that
-- query word for word.
--
-- Fits the version before it: an index changes no row and no answer. Building
-- it holds back writes to the activities for as long as it takes; for fifty
-- thousand activities that was less than a tenth of a second.

CREATE INDEX "activities_open_idx" ON "activities" USING btree ("tenant_id") WHERE "activities"."deleted_at" is null and "activities"."status" in ('open', 'started', 'signed');--> statement-breakpoint
CREATE INDEX "activities_changed_idx" ON "activities" USING btree ("tenant_id","updated_at") WHERE "activities"."deleted_at" is null;