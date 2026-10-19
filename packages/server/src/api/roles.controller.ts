import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  isShippedRole,
  newRightsOf,
  offerableRights,
  ownRoleProblems,
  ownRoleWords,
  type Right,
  type RoleEntry,
  withImplied,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, type TenantTransaction } from '@opengewerk/platform-server'
import { invitations, memberships, tenantRoles } from '@opengewerk/platform-server/schema'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'

import { RequiresPermission } from './authorization.js'
import { type Asking, refuse } from './places.js'

/**
 * The roles of a tenant and those it makes for itself (section 7 of the
 * concept, #346, decided by Moritz on 15.10.2026).
 *
 * The rows are the foundation's (`tenant_roles`) and what somebody may do is
 * read from them on every request, so a change holds at the next request of
 * everybody with the role, on the session that is open. The list is read by
 * whoever looks at the accesses, a role is made, changed and removed by
 * whoever keeps them; both are the Leitung's.
 *
 * A role the application ships stays as it is. A role of the tenant's own
 * holds only rights a role of its own may hold (`offerableRights`), with what
 * comes with each (`withImplied`), never leads the tenant and may ask for a
 * second factor. It keeps what the catalogue offered when it was saved, so
 * that a right a later version brings is told apart from one it was not
 * given (`newRightsOf`). One that a membership or an open invitation names
 * is not removed; one removed in the same moment as somebody is given it
 * leaves a membership that names a role without a row, which gives nothing.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly database: Database) {}

  /** Every role of the tenant in the order it was made, with how many hold it and what is new for it. */
  @Get()
  @RequiresPermission('membership.read')
  list(@CurrentIdentity() identity: Asking): Promise<RoleEntry[]> {
    return this.database.forTenant(identity, (tx) => rolesOf(tx))
  }

  /** A role of the tenant's own, under a key the server makes. */
  @Post()
  @RequiresPermission('membership.write')
  make(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<RoleEntry> {
    const given = fieldsOf(body)

    refuse(ownRoleProblems({ ...given, label: given.label ?? null, rights: given.rights ?? null }))

    return this.database.forTenant(identity, async (tx) => {
      const label = (given.label as string).trim()

      await refuseTakenLabel(tx, label, null)

      const key = `own-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

      await tx.insert(tenantRoles).values({
        tenantId: identity.tenantId,
        key,
        label,
        rights: withImplied(given.rights as Right[]),
        leads: false,
        secondFactor: given.secondFactor === true,
        offeredRights: [...offerableRights],
      })

      return entryOf(tx, key)
    })
  }

  /**
   * Its label, its rights and whether it asks for a second factor, of a role
   * of the tenant's own. Saving it offers it the catalogue as it is now, so
   * what a later version brought is no longer new for it.
   */
  @Patch(':key')
  @RequiresPermission('membership.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<RoleEntry> {
    const given = fieldsOf(body)

    refuse(ownRoleProblems(given))

    return this.database.forTenant(identity, async (tx) => {
      await heldOwnRole(tx, key)

      const label = typeof given.label === 'string' ? given.label.trim() : undefined

      if (label !== undefined) {
        await refuseTakenLabel(tx, label, key)
      }

      await tx
        .update(tenantRoles)
        .set({
          ...(label === undefined ? {} : { label }),
          ...(given.rights === undefined ? {} : { rights: withImplied(given.rights as Right[]) }),
          ...(given.secondFactor === undefined
            ? {}
            : { secondFactor: given.secondFactor === true }),
          offeredRights: [...offerableRights],
          updatedAt: new Date(),
        })
        .where(and(eq(tenantRoles.tenantId, identity.tenantId), eq(tenantRoles.key, key)))

      return entryOf(tx, key)
    })
  }

  /** A role of the tenant's own that nobody holds and no open invitation names. */
  @Delete(':key')
  @RequiresPermission('membership.write')
  remove(@CurrentIdentity() identity: Asking, @Param('key') key: string): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      await heldOwnRole(tx, key)

      const { holders, invited } = await namedBy(tx, key)

      if (holders > 0 || invited > 0) {
        throw new ConflictException(ownRoleWords.inUse(holders, invited))
      }

      await tx
        .delete(tenantRoles)
        .where(and(eq(tenantRoles.tenantId, identity.tenantId), eq(tenantRoles.key, key)))
    })
  }
}

/** What a body names of a role: only the fields there are, unknown ones refused. */
function fieldsOf(body: unknown): {
  readonly label?: unknown
  readonly rights?: unknown
  readonly secondFactor?: unknown
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Erwartet wird eine Rolle mit Bezeichnung und Rechten.')
  }

  const unknown = Object.keys(body).filter(
    (name) => !['label', 'rights', 'secondFactor'].includes(name),
  )

  if (unknown.length > 0) {
    throw new BadRequestException(`Unbekannte Angaben: ${unknown.join(', ')}.`)
  }

  return body as { label?: unknown; rights?: unknown; secondFactor?: unknown }
}

/** A role of the tenant's own the person sees, or the refusal: none, or one the application ships. */
async function heldOwnRole(tx: TenantTransaction, key: string): Promise<void> {
  if (isShippedRole(key)) {
    throw new ConflictException(ownRoleWords.shippedStays)
  }

  const [row] = await tx
    .select({ key: tenantRoles.key })
    .from(tenantRoles)
    .where(eq(tenantRoles.key, key))
    .for('update')

  if (row === undefined) {
    throw new NotFoundException(ownRoleWords.missing)
  }
}

/** Two roles of a tenant are not called the same, whatever the case, or a person could not tell them apart. */
async function refuseTakenLabel(
  tx: TenantTransaction,
  label: string,
  key: string | null,
): Promise<void> {
  const [taken] = await tx
    .select({ key: tenantRoles.key })
    .from(tenantRoles)
    .where(sql`lower(${tenantRoles.label}) = lower(${label})`)

  if (taken !== undefined && taken.key !== key) {
    throw new ConflictException(ownRoleWords.labelTaken(label))
  }
}

/** How many memberships name a role, blocked ones included, and how many invitations still open. */
async function namedBy(
  tx: TenantTransaction,
  key: string,
): Promise<{ holders: number; invited: number }> {
  const [held] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(sql`${key} = any(${memberships.roles})`)
  const [open] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invitations)
    .where(
      and(
        sql`${key} = any(${invitations.roles})`,
        isNull(invitations.redeemedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )

  return { holders: held?.count ?? 0, invited: open?.count ?? 0 }
}

/** The roles of the tenant as the list shows them, in the order they were made. */
export async function rolesOf(tx: TenantTransaction): Promise<RoleEntry[]> {
  const rows = await tx.select().from(tenantRoles).orderBy(asc(tenantRoles.id))
  const entries: RoleEntry[] = []

  for (const row of rows) {
    entries.push({
      key: row.key,
      label: row.label,
      rights: row.rights,
      leads: row.leads,
      secondFactor: row.secondFactor,
      shipped: isShippedRole(row.key),
      ...(await namedBy(tx, row.key)),
      newRights: newRightsOf(row),
    })
  }

  return entries
}

async function entryOf(tx: TenantTransaction, key: string): Promise<RoleEntry> {
  const entry = (await rolesOf(tx)).find((each) => each.key === key)

  if (entry === undefined) {
    throw new NotFoundException(ownRoleWords.missing)
  }

  return entry
}
