-- Three records the foundation keeps since the security review (#360), each a
-- column or table of the foundation added here with a migration of this
-- application's own; the statements are those of 0082, 0083 and 0084 in the
-- repository opengewerk.
--
-- **The person of a conflict** (`sync_conflicts.user_id`). Until now the list
-- and closing a conflict asked for the device alone, and on a device passed
-- from hand to hand the next person saw the conflicts of the one before. From
-- now on the server writes the person of the session into every new conflict
-- and lists and closes by both. The conflicts of before get a person where
-- the stretches of work tell exactly one (`tenant_sessions`: a session chosen
-- with this device, begun when the conflict came and not ended before it).
-- Where several had one or none had, nobody can be told; such a conflict
-- keeps no person, is shown to nobody and stays open, since nobody decided it.
--
-- **Who stored a file** (`file_uploads`). The row of a file is one for the
-- whole operator, and a record that names a file by its hash is how its bytes
-- are handed out; whoever knew the hash of a file in another area named it in
-- a record of their own and read it there. From now on a record names a file
-- only when the person stored it themselves or a row in their reach names it
-- already (`mayNameFile`). A person reads and adds their own rows only, added
-- and never changed or removed, and outside the change log like the files.
-- The files of before get a row for the person the change log names as the
-- one who inserted their row of `files`.
--
-- **New passwords and new mail servers of the instance** (`password_resets`,
-- `account_mail_server_changes`). The link to a new password goes out through
-- the mail server of the instance, and whoever sets that up could read the
-- links there. From now on every operator keeps a row per new password of an
-- account that works for it, never the link or its token, and a row per change
-- of that mail server. Both are added and stay, in the change log.
--
-- Row level security is lifted on `sync_conflicts`, `tenant_sessions` and
-- `files` for the statements that fill in what was before, because as the
-- owner under FORCE they would find no row and say nothing.
--
-- **Fits the version before it.** That version knows nothing of the column and
-- the tables: it writes conflicts without a person, which then nobody sees,
-- and no rows into the new tables.
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_mail_server_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host_before" text,
	"from_before" text,
	"host_after" text,
	"from_after" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_mail_server_changes_before_in_a_pair" CHECK (("account_mail_server_changes"."host_before" is null) = ("account_mail_server_changes"."from_before" is null)),
	CONSTRAINT "account_mail_server_changes_after_in_a_pair" CHECK (("account_mail_server_changes"."host_after" is null) = ("account_mail_server_changes"."from_after" is null)),
	CONSTRAINT "account_mail_server_changes_names_a_server" CHECK ("account_mail_server_changes"."host_before" is not null or "account_mail_server_changes"."host_after" is not null)
);
--> statement-breakpoint
ALTER TABLE "account_mail_server_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reset_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_in_tenant" FOREIGN KEY ("tenant_id","sha256") REFERENCES "public"."files"("tenant_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_mail_server_changes" ADD CONSTRAINT "account_mail_server_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_person_works_here" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_uploads_once" ON "file_uploads" USING btree ("tenant_id","sha256","user_id");--> statement-breakpoint
CREATE INDEX "password_resets_person_idx" ON "password_resets" USING btree ("tenant_id","user_id","reset_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "file_uploads" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("file_uploads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("file_uploads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "held_by_the_person_asking" ON "file_uploads" AS RESTRICTIVE FOR ALL TO "opengewerk_app" USING ("file_uploads"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("file_uploads"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_mail_server_changes" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("account_mail_server_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("account_mail_server_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "password_resets" AS PERMISSIVE FOR ALL TO "opengewerk_app" USING ("password_resets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("password_resets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sync_conflicts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_sessions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "sync_conflicts" AS "conflict" SET "user_id" = "told"."user_id"
	FROM (
		SELECT "c"."id", min("s"."user_id") AS "user_id"
		FROM "sync_conflicts" AS "c"
		JOIN "tenant_sessions" AS "s"
			ON "s"."tenant_id" = "c"."tenant_id"
			AND "s"."device_id" = "c"."device_id"
			AND "s"."started_at" <= "c"."created_at"
			AND ("s"."ended_at" IS NULL OR "s"."ended_at" >= "c"."created_at")
		GROUP BY "c"."id"
		HAVING count(DISTINCT "s"."user_id") = 1
	) AS "told"
	WHERE "told"."id" = "conflict"."id";--> statement-breakpoint
ALTER TABLE "tenant_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "file_uploads" ("tenant_id", "sha256", "user_id", "created_at", "updated_at")
	SELECT "f"."tenant_id", "f"."sha256", "e"."user_id", min("e"."changed_at"), min("e"."changed_at")
	FROM "audit_entries" AS "e"
	JOIN "files" AS "f"
		ON "f"."tenant_id" = "e"."tenant_id"
		AND "f"."id" = "e"."record_id"
	WHERE "e"."table_name" = 'files'
		AND "e"."operation" = 'insert'
		AND "e"."user_id" IS NOT NULL
	GROUP BY "f"."tenant_id", "f"."sha256", "e"."user_id";--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "file_uploads" TO "opengewerk_app";--> statement-breakpoint

ALTER TABLE "password_resets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "password_resets" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "password_resets"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();--> statement-breakpoint

ALTER TABLE "account_mail_server_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "account_mail_server_changes" TO "opengewerk_app";--> statement-breakpoint
CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "account_mail_server_changes"
	FOR EACH ROW EXECUTE FUNCTION "record_change"();
