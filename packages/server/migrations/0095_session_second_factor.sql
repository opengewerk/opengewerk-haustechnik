-- The second factor becomes a property of the session (#360). Until now a
-- role that needs it and the area of the instance read it off the account, so
-- a session that began with the password alone counted as one with a second
-- factor once the account got the app. From now on the server writes it into
-- the session when the session begins, and asks only that. The column is the
-- foundation's (`auth_sessions.second_factor`, 0081 in the repository
-- opengewerk), added here with a migration of this application's own; the
-- statements are the same.
--
-- **What the sessions of before get.** One that began with a passkey had its
-- second factor from the start and keeps it. One that began with the password
-- on an account with the app cannot be told apart: it may have come with the
-- code, or it may be older than the app. Those end, as a new password ends
-- every other session; whoever was signed in that way signs in once more with
-- the code. A session of the password on an account without the app had no
-- second factor and keeps having none.
--
-- Row level security is lifted on the sessions for the two statements,
-- because as the owner under FORCE they would find no row and say nothing.
-- The accounts the owner reads anyway (`readable_by_the_owner`, 0000).
--
-- **Fits the version before it.** That version knows nothing of the column,
-- and a session it writes gets the default, no second factor.
ALTER TABLE "auth_sessions" ADD COLUMN "second_factor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "auth_sessions" SET "second_factor" = true WHERE "sign_in_method" = 'passkey';--> statement-breakpoint
DELETE FROM "auth_sessions"
	WHERE "sign_in_method" = 'password'
	AND "user_id" IN (SELECT "id" FROM "auth_users" WHERE "two_factor_enabled" IS TRUE);--> statement-breakpoint
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
