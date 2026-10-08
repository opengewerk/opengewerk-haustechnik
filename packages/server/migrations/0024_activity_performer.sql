-- Whether the own people or a contractor perform an activity (#105, section
-- 4.4 of the concept: "eigene" or "fremde Durchführung").
--
-- An activity named the person who carries it out and a contractor in words,
-- but not which of the two ways it goes. The office plans it, and the activity
-- that comes of the due day of a duty starts with what the duty says, so it
-- takes the values of a duty. Null until somebody says.
--
-- A person carrying it out is one of the own people, a contractor's name
-- belongs to a contractor. No row breaks either: nothing wrote a person or a
-- contractor to an activity before this.
ALTER TABLE "activities" ADD COLUMN "performer" "duty_performer";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_performed_by_own_staff" CHECK ("activities"."performer_user_id" is null or "activities"."performer" = 'own_staff');--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contractor_named_for_a_contractor" CHECK ("activities"."contractor_note" is null or "activities"."performer" = 'contractor');
