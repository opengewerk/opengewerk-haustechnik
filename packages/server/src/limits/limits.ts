import { BadRequestException } from '@nestjs/common'
import {
  byNameIn,
  type InvitationId,
  type InvitationLimits,
  isLimited,
  limitsProblem,
  limitWords,
  type MemberLimits,
  type MemberLimitsOf,
  noLimits,
  type OwnLimits,
  type PropertyId,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { isUuid, stillOpen, type TenantTransaction } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { and, eq, inArray } from 'drizzle-orm'

import {
  invitationLimitAssetKinds,
  invitationLimitProperties,
  invitations,
  memberLimitAssetKinds,
  memberLimitProperties,
  properties,
} from '../database/schema/index.js'

// What an access from outside is limited to beside its areas (#339): read
// from what a request names under `additions.limits`, written with an
// invitation, carried over into the membership it becomes, and replaced with a
// change of roles. The database holds it (`within_limits`); this only writes
// the rows its two functions read.

/**
 * What a body says of the limits, under `limits` beside the areas: nothing,
 * which leaves them as they are, null for none, or both lists.
 */
export function limitsFrom(said: unknown): MemberLimits | undefined {
  if (typeof said !== 'object' || said === null || !('limits' in said)) {
    return undefined
  }

  const limits = (said as { readonly limits: unknown }).limits

  if (limits === null) {
    return noLimits
  }

  if (typeof limits !== 'object') {
    throw new BadRequestException('limits nennt Liegenschaften und Anlagenarten.')
  }

  const { propertyIds = [], assetKinds = [] } = limits as Readonly<Record<string, unknown>>

  if (!Array.isArray(propertyIds) || !propertyIds.every((id) => isUuid(id))) {
    throw new BadRequestException(limitWords.unknownProperty)
  }

  if (!Array.isArray(assetKinds) || !assetKinds.every((kind) => typeof kind === 'string')) {
    throw new BadRequestException(limitWords.unknownKind)
  }

  return {
    propertyIds: [...new Set(propertyIds as PropertyId[])],
    assetKinds: [...new Set(assetKinds as string[])],
  }
}

/** Refuses limits for roles that are not limited, and properties the tenant does not have. */
export async function checkedLimits(
  tx: TenantTransaction,
  roles: readonly string[],
  limits: MemberLimits,
): Promise<void> {
  const problem = limitsProblem(roles, limits)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  if (limits.propertyIds.length === 0) {
    return
  }

  const found = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(inArray(properties.id, [...limits.propertyIds]))

  if (found.length !== limits.propertyIds.length) {
    throw new BadRequestException(limitWords.unknownProperty)
  }
}

/** The limits an invitation names, kept until it is taken up. */
export async function inviteLimits(
  tx: TenantTransaction,
  invitation: { readonly tenantId: TenantId; readonly invitationId: InvitationId },
  limits: MemberLimits,
): Promise<void> {
  const { tenantId, invitationId } = invitation

  if (limits.propertyIds.length > 0) {
    await tx
      .insert(invitationLimitProperties)
      .values(limits.propertyIds.map((propertyId) => ({ tenantId, invitationId, propertyId })))
  }

  if (limits.assetKinds.length > 0) {
    await tx
      .insert(invitationLimitAssetKinds)
      .values(limits.assetKinds.map((assetKind) => ({ tenantId, invitationId, assetKind })))
  }
}

/** What a membership is limited to from now on: the rows before go, the ones named come. */
export async function setMemberLimits(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
  limits: MemberLimits,
): Promise<void> {
  await tx
    .delete(memberLimitProperties)
    .where(
      and(eq(memberLimitProperties.tenantId, tenantId), eq(memberLimitProperties.userId, userId)),
    )
  await tx
    .delete(memberLimitAssetKinds)
    .where(
      and(eq(memberLimitAssetKinds.tenantId, tenantId), eq(memberLimitAssetKinds.userId, userId)),
    )

  if (limits.propertyIds.length > 0) {
    await tx
      .insert(memberLimitProperties)
      .values(limits.propertyIds.map((propertyId) => ({ tenantId, userId, propertyId })))
  }

  if (limits.assetKinds.length > 0) {
    await tx
      .insert(memberLimitAssetKinds)
      .values(limits.assetKinds.map((assetKind) => ({ tenantId, userId, assetKind })))
  }
}

/** The membership an invitation became holds what the invitation limited it to. */
export async function joinLimits(
  tx: TenantTransaction,
  membership: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly invitationId: InvitationId
    readonly roles: readonly string[]
  },
): Promise<void> {
  const { tenantId, userId, invitationId } = membership
  const named = await invitationLimitsOf(tx, [invitationId])
  const limits = named.get(invitationId) ?? noLimits

  // A membership that existed before keeps no limit it had, and one whose
  // roles are not limited holds none.
  await setMemberLimits(tx, tenantId, userId, isLimited(membership.roles) ? limits : noLimits)
}

/**
 * A change of roles: with limits named, these; without, the ones held stay
 * while the roles are limited, and go with a role that is not.
 */
export async function changeLimits(
  tx: TenantTransaction,
  membership: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly roles: readonly string[]
  },
  said: unknown,
): Promise<void> {
  const limits = limitsFrom(said)

  if (limits !== undefined) {
    await checkedLimits(tx, membership.roles, limits)
    await setMemberLimits(tx, membership.tenantId, membership.userId, limits)

    return
  }

  if (!isLimited(membership.roles)) {
    await setMemberLimits(tx, membership.tenantId, membership.userId, noLimits)
  }
}

/** The limits of every membership that has one, for "Zugänge". */
export async function memberLimitsOf(tx: TenantTransaction): Promise<MemberLimitsOf[]> {
  const byProperty = await tx
    .select({ userId: memberLimitProperties.userId, propertyId: memberLimitProperties.propertyId })
    .from(memberLimitProperties)
  const byKind = await tx
    .select({ userId: memberLimitAssetKinds.userId, assetKind: memberLimitAssetKinds.assetKind })
    .from(memberLimitAssetKinds)
  const userIds = [...new Set([...byProperty, ...byKind].map((row) => row.userId))].sort()

  return userIds.map((userId) => ({
    userId,
    propertyIds: byProperty.filter((row) => row.userId === userId).map((row) => row.propertyId),
    assetKinds: byKind.filter((row) => row.userId === userId).map((row) => row.assetKind),
  }))
}

async function invitationLimitsOf(
  tx: TenantTransaction,
  invitationIds: readonly InvitationId[],
): Promise<ReadonlyMap<InvitationId, MemberLimits>> {
  if (invitationIds.length === 0) {
    return new Map()
  }

  const byProperty = await tx
    .select({
      invitationId: invitationLimitProperties.invitationId,
      propertyId: invitationLimitProperties.propertyId,
    })
    .from(invitationLimitProperties)
    .where(inArray(invitationLimitProperties.invitationId, [...invitationIds]))
  const byKind = await tx
    .select({
      invitationId: invitationLimitAssetKinds.invitationId,
      assetKind: invitationLimitAssetKinds.assetKind,
    })
    .from(invitationLimitAssetKinds)
    .where(inArray(invitationLimitAssetKinds.invitationId, [...invitationIds]))

  return new Map(
    invitationIds.map((id) => [
      id,
      {
        propertyIds: byProperty
          .filter((row) => row.invitationId === id)
          .map((row) => row.propertyId),
        assetKinds: byKind.filter((row) => row.invitationId === id).map((row) => row.assetKind),
      },
    ]),
  )
}

/** What the invitations that can still be used limit to; one that limits nothing is not listed. */
export async function openInvitationLimits(tx: TenantTransaction): Promise<InvitationLimits[]> {
  const open = await tx.select({ id: invitations.id }).from(invitations).where(stillOpen())
  const named = await invitationLimitsOf(
    tx,
    open.map((row) => row.id),
  )

  return [...named]
    .filter(([, limits]) => limits.propertyIds.length > 0 || limits.assetKinds.length > 0)
    .map(([invitationId, limits]) => ({ invitationId, ...limits }))
}

/** What one person is limited to, by the names of the properties, and the last day of their access. */
export async function ownLimitsOf(
  tx: TenantTransaction,
  userId: string,
  roles: readonly string[],
): Promise<OwnLimits> {
  const [membership] = await tx
    .select({ lastDay: memberships.lastDay })
    .from(memberships)
    .where(eq(memberships.userId, userId))
  const named = await tx
    .select({ name: properties.name })
    .from(memberLimitProperties)
    .innerJoin(properties, eq(properties.id, memberLimitProperties.propertyId))
    .where(eq(memberLimitProperties.userId, userId))
  const kinds = await tx
    .select({ assetKind: memberLimitAssetKinds.assetKind })
    .from(memberLimitAssetKinds)
    .where(eq(memberLimitAssetKinds.userId, userId))

  return {
    auditor: isLimited(roles),
    lastDay: membership?.lastDay ?? null,
    properties: named.map((row) => row.name).sort(byNameIn),
    assetKinds: kinds.map((row) => row.assetKind).sort(),
  }
}
