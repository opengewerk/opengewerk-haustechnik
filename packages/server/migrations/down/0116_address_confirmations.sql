-- Takes the addresses that wait for their link out again, back to how 0115
-- left things. A link in a mail that went out stops working. Which addresses
-- were confirmed stays in `auth_users`, which the version before reads not;
-- which of them had been confirmed by a link is kept nowhere, so there is
-- nothing to go back to either.
--
-- Run as the superuser, like every rollback.
DROP POLICY IF EXISTS "outside_any_tenant" ON "auth_address_confirmations";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_address_confirmations";
