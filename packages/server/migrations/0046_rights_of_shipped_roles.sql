-- The rights of the shipped roles, for the tenants that are already there
-- (opengewerk-haustechnik#270).
--
-- Written by hand; the schema does not change.
--
-- The roles of a tenant are rows, written when it comes into being with the
-- rights the code gave them on that day, and what somebody may do is read
-- from those rows on every request. A right that came later reached every
-- tenant made after it and none that was there: the rights to documents, to
-- tasks and templates, to push and to the mail server all came after the
-- first migration, and no migration wrote one of them into a row.
--
-- This one does, for all of them at once: each of the four roles a tenant
-- starts with is given what it holds in the code at this moment and its row
-- lacks. **From here on a right given to one of the four is a migration like
-- this one**, naming the roles that get it and the right. A test holds the
-- rows of a tenant from before this migration against the roles in the code
-- (`update.test.ts`, "a tenant whose roles are from before a right") and is
-- red for a right that no migration gives.
--
-- **It adds, and takes nothing.** A row keeps every right it has, in the
-- order it has them, and gets the missing ones behind them in the order of
-- the catalogue. A row that lacks nothing is not touched and gets no entry in
-- the log. A role under a key of the tenant's own is none of the four.
--
-- **Nothing beyond section 7 of the concept.** The lists are those of
-- `shippedRoles` on this day, which a test holds against the table there.
--
-- Migrations run as the owner of the tables. `tenant_roles` stands on FORCE
-- ROW LEVEL SECURITY, and the one policy on it that names the owner lets it
-- read: an UPDATE would change no row and say so by succeeding. FORCE is
-- lifted for the length of the statement, inside the transaction every
-- pending migration runs in, so a failure takes the switch back with
-- everything else.
--
-- **Named in the log.** Every changed row gets its entry in the log of its
-- tenant like any other change, and the reason says where it came from:
-- `migration`, for the length of this statement and not for whatever runs
-- after it in the same transaction.
--
-- **Fits the version before it.** That version reads the same rows, and every
-- right written here is in its catalogue.
--
-- On a database without a tenant the statement finds nothing to do.

ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles" AS "role"
   SET "rights" = "role"."rights" || "missing"."rights",
       "updated_at" = now()
  FROM (
	SELECT "held"."id",
	       array_agg("shipped"."right" ORDER BY "shipped"."position") AS "rights"
	  FROM "tenant_roles" AS "held"
	  JOIN (
		VALUES
			('management', ARRAY[
				'location.read', 'location.write', 'room.record', 'asset.read',
				'asset.record', 'asset.write', 'reading.write', 'duty.read',
				'duty.write', 'deadline.read', 'deadline.write', 'activity.read',
				'activity.perform', 'activity.write', 'template.write', 'activity.accept',
				'evidence.read', 'evidence.write', 'defect.read', 'defect.report',
				'defect.write', 'document.read', 'document.record', 'document.remove',
				'task.read', 'task.record', 'task.assign', 'sync.read',
				'sync.write', 'push.write', 'membership.read', 'membership.write',
				'settings.read', 'settings.write', 'mail.read', 'mail.write',
				'audit.read'
			]::text[]),
			('technical_management', ARRAY[
				'location.read', 'location.write', 'room.record', 'asset.read',
				'asset.record', 'asset.write', 'reading.write', 'duty.read',
				'duty.write', 'deadline.read', 'deadline.write', 'activity.read',
				'activity.perform', 'activity.write', 'template.write', 'activity.accept',
				'evidence.read', 'evidence.write', 'defect.read', 'defect.report',
				'defect.write', 'document.read', 'document.record', 'document.remove',
				'task.read', 'task.record', 'task.assign', 'sync.read',
				'sync.write', 'push.write'
			]::text[]),
			('site_management', ARRAY[
				'location.read', 'room.record', 'asset.read', 'asset.record',
				'asset.write', 'reading.write', 'duty.read', 'activity.read',
				'activity.perform', 'activity.write', 'template.write', 'activity.accept',
				'evidence.read', 'evidence.write', 'defect.read', 'defect.report',
				'defect.write', 'document.read', 'document.record', 'document.remove',
				'task.read', 'task.record', 'task.assign', 'sync.read',
				'sync.write', 'push.write'
			]::text[]),
			('technician', ARRAY[
				'location.read', 'room.record', 'asset.read', 'asset.record',
				'reading.write', 'duty.read', 'activity.read', 'activity.perform',
				'evidence.read', 'defect.read', 'defect.report', 'document.read',
				'document.record', 'task.read', 'task.record', 'sync.read',
				'sync.write', 'push.write'
			]::text[])
	  ) AS "version" ("key", "rights") ON "version"."key" = "held"."key"
	 CROSS JOIN LATERAL unnest("version"."rights") WITH ORDINALITY AS "shipped" ("right", "position")
	 WHERE "shipped"."right" <> ALL ("held"."rights")
	 GROUP BY "held"."id"
  ) AS "missing"
 WHERE "missing"."id" = "role"."id";--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
