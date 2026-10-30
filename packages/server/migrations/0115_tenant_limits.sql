-- Two settings of the instance that bound what one operator takes of what
-- all share (opengewerk-haustechnik#592, B9 and N11 of the security audit of
-- the repository opengewerk), set by whoever manages the instance under
-- "Einstellungen" in its area. The columns are the foundation's
-- (opengewerk/opengewerk#763).
--
-- **`tenant_storage_bytes`**: what one operator may keep in the file store, in
-- bytes, asked with every file somebody puts there. Null for no limit, which
-- is what every instance has until somebody sets one.
--
-- **`own_tenants_allowed`**: whether whoever leads an operator may make
-- further operators of their own, at most five per account. On, as it was.
--
-- The row of settings keeps its values; the two columns come with theirs, and
-- the log of the instance writes nothing for them, as no row changes. A
-- version of the application from before this migration runs on unchanged.
ALTER TABLE "instance_settings" ADD COLUMN "tenant_storage_bytes" bigint;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "own_tenants_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_tenant_storage" CHECK ("instance_settings"."tenant_storage_bytes" is null or "instance_settings"."tenant_storage_bytes" > 0);