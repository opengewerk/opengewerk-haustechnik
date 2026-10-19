-- A second number for a contact, mostly the mobile one (#428, Moritz on
-- 18.10.2026: "Ansprechpartner bekommt ein zweites Feld „Mobil“"). The column
-- is the foundation's (`contactsSchema`, opengewerk/opengewerk#677); the bound
-- is this application's, the same as for the first number. Contacts of before
-- have none, which the check lets stand.
ALTER TABLE "contacts" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_mobile_shaped" CHECK ("contacts"."mobile" is null or ("contacts"."mobile" = btrim("contacts"."mobile") and char_length("contacts"."mobile") between 1 and 40));