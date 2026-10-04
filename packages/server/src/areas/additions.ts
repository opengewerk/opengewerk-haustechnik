import { BadRequestException } from '@nestjs/common'
import {
  type InvitationAreas,
  type MemberAreas,
  memberAreasProblem,
  seesEveryArea,
} from '@opengewerk/haustechnik-domain'
import {
  type MembershipAdditions,
  stillOpen,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'

import { invitationAreaChoices, invitationAreas, invitations } from '../database/schema/index.js'
import { areasFrom, requireAreas, setMemberAreas } from './areas.js'

// What this application keeps beside a membership: the areas somebody holds
// in (section 2.8 of the concept, ADR 0003). The foundation knows a membership
// by its roles alone and calls the three functions below inside the
// transaction that writes an invitation, the membership an invitation becomes,
// or a change of roles (ADR 0010 in the repository opengewerk). So a role and
// the areas that go with it are written together or not at all: the Leitung
// invites with both in one step, and saves both with one "Speichern".
//
// A request that says nothing about areas is taken as it always was. Nothing
// is asked of a caller that does not know of areas, and what holds then is
// said at each of the three.

/** Every area, as a membership holds it that is not narrowed to some. */
const everyArea = { all: true, areaIds: [] } as const

/** Whether a body said anything about areas at all. */
function nothing(said: unknown): said is null | undefined {
  return said === undefined || said === null
}

/**
 * What a body says about areas, held against the roles it is said with. A
 * role and areas that do not go together are a mistake of the request itself,
 * unlike areas named for somebody who already has the role.
 */
function areasFor(roles: readonly string[], said: unknown): Pick<MemberAreas, 'all' | 'areaIds'> {
  const wanted = areasFrom(said)
  const problem = memberAreasProblem(roles, wanted)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  return wanted
}

/** The three moments the foundation hands on (`MembershipAdditions`). */
export const areaAdditions: MembershipAdditions = {
  /**
   * An invitation that names areas keeps them until it is taken up: every
   * area, or the ones named, none included. One that says nothing keeps
   * nothing, and the membership it becomes begins with what the database
   * gives a new one.
   */
  async invited(tx, invitation, said) {
    if (nothing(said)) {
      return
    }

    const wanted = areasFor(invitation.roles, said)
    const areaIds = wanted.all ? [] : wanted.areaIds
    const { tenantId, invitationId } = invitation

    await requireAreas(tx, areaIds)
    await tx.insert(invitationAreaChoices).values({ tenantId, invitationId, everyArea: wanted.all })

    if (areaIds.length > 0) {
      await tx
        .insert(invitationAreas)
        .values(areaIds.map((areaId) => ({ tenantId, invitationId, areaId })))
    }
  },

  /**
   * The membership an invitation became holds in what the invitation said,
   * from its first request on. An area removed meanwhile is no longer named:
   * its row went with it, and an invitation that named only that one leaves
   * somebody who holds in none, which the list of who works for the tenant
   * says.
   *
   * Where the invitation said nothing, a new membership keeps what the
   * database gave it, and one that existed before, blocked or with other
   * roles, keeps the areas it had. With one exception: roles that hold in
   * every area do so, whatever was named for the person before.
   */
  async joined(tx, membership) {
    const { tenantId, userId, invitationId } = membership
    const [choice] = await tx
      .select({ everyArea: invitationAreaChoices.everyArea })
      .from(invitationAreaChoices)
      .where(
        and(
          eq(invitationAreaChoices.tenantId, tenantId),
          eq(invitationAreaChoices.invitationId, invitationId),
        ),
      )

    if (choice === undefined) {
      if (seesEveryArea(membership.roles)) {
        await setMemberAreas(tx, tenantId, userId, everyArea)
      }

      return
    }

    const named = choice.everyArea
      ? []
      : await tx
          .select({ areaId: invitationAreas.areaId })
          .from(invitationAreas)
          .where(
            and(
              eq(invitationAreas.tenantId, tenantId),
              eq(invitationAreas.invitationId, invitationId),
            ),
          )

    await setMemberAreas(tx, tenantId, userId, {
      all: choice.everyArea,
      areaIds: named.map((row) => row.areaId),
    })
  },

  /**
   * A change of roles takes the areas named with it along. Without any, roles
   * that hold in every area are given every area, and everybody else keeps
   * what they had: somebody who led the tenant and no longer does holds in
   * all of them until their areas are named.
   */
  async changed(tx, membership, said) {
    const { tenantId, userId, roles } = membership

    if (!nothing(said)) {
      await setMemberAreas(tx, tenantId, userId, areasFor(roles, said))
    } else if (seesEveryArea(roles)) {
      await setMemberAreas(tx, tenantId, userId, everyArea)
    }
  },
}

/**
 * What the invitations of the tenant that can still be used say about areas.
 * One that says nothing is not in the list.
 */
export async function openInvitationAreas(tx: TenantTransaction): Promise<InvitationAreas[]> {
  const choices = await tx
    .select({
      invitationId: invitationAreaChoices.invitationId,
      all: invitationAreaChoices.everyArea,
    })
    .from(invitationAreaChoices)
    .innerJoin(
      invitations,
      and(
        eq(invitations.tenantId, invitationAreaChoices.tenantId),
        eq(invitations.id, invitationAreaChoices.invitationId),
      ),
    )
    .where(stillOpen())
  const named = await tx
    .select({ invitationId: invitationAreas.invitationId, areaId: invitationAreas.areaId })
    .from(invitationAreas)

  return choices.map((choice) => ({
    ...choice,
    areaIds: named
      .filter((row) => row.invitationId === choice.invitationId)
      .map((row) => row.areaId),
  }))
}
