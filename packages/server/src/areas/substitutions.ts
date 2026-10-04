import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  type Id,
  type IsoDate,
  newSubstitutionProblem,
  type Substitution,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'

import { memberships, substitutions } from '../database/schema/index.js'

// Who stands in for whom (section 2.8 of the concept, ADR 0003, point 3). On
// its days the substitute sees the areas of the absent person beside their
// own, which the database reads from the rows kept here; nothing is copied,
// so ending one is taking its row away.

/** A substitution as the list of them names it. */
export type SubstitutionEntry = Substitution & { readonly id: Id<'substitution'> }

const entry = {
  id: substitutions.id,
  substitute: substitutions.substituteUserId,
  absent: substitutions.absentUserId,
  startsOn: substitutions.startsOn,
  endsOn: substitutions.endsOn,
}

/**
 * The substitutions that run or are still to come, the next first. One that
 * has ended does nothing any more and is not listed; the change log of the
 * tenant keeps who entered and who ended it.
 */
export function listSubstitutions(
  tx: TenantTransaction,
  today: IsoDate,
): Promise<SubstitutionEntry[]> {
  return tx
    .select(entry)
    .from(substitutions)
    .where(gte(substitutions.endsOn, today))
    .orderBy(asc(substitutions.startsOn), asc(substitutions.endsOn)) as Promise<SubstitutionEntry[]>
}

/**
 * Enters a substitution. Both people work for the tenant, and the substitute
 * can work: a blocked person sees nothing, so one would stand in for nobody.
 * The absent person may be blocked, which is the case the concept names,
 * somebody leaves and the substitution takes over.
 *
 * The same two people twice for overlapping days is refused: the second row
 * would add nothing, and ending one would leave the other running unnoticed.
 */
export async function enterSubstitution(
  tx: TenantTransaction,
  tenantId: TenantId,
  wanted: Readonly<Record<string, unknown>>,
  today: IsoDate,
): Promise<SubstitutionEntry> {
  const problem = newSubstitutionProblem(wanted, today)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  const { substitute, absent, startsOn, endsOn } = wanted as unknown as Substitution
  const people = await tx
    .select({ userId: memberships.userId, blockedAt: memberships.blockedAt })
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, [substitute, absent])),
    )
  const standingIn = people.find((person) => person.userId === substitute)

  if (standingIn === undefined) {
    throw new BadRequestException('Wer vertritt, arbeitet nicht für diesen Betreiber.')
  }

  if (!people.some((person) => person.userId === absent)) {
    throw new BadRequestException('Wer vertreten wird, arbeitet nicht für diesen Betreiber.')
  }

  if (standingIn.blockedAt !== null) {
    throw new ConflictException('Wer gesperrt ist, vertritt niemanden.')
  }

  const [overlapping] = await tx
    .select({ id: substitutions.id })
    .from(substitutions)
    .where(
      and(
        eq(substitutions.substituteUserId, substitute),
        eq(substitutions.absentUserId, absent),
        lte(substitutions.startsOn, endsOn),
        gte(substitutions.endsOn, startsOn),
      ),
    )
    .limit(1)

  if (overlapping !== undefined) {
    throw new ConflictException('Für diese Tage gibt es diese Vertretung schon.')
  }

  const [entered] = await tx
    .insert(substitutions)
    .values({
      tenantId,
      substituteUserId: substitute,
      absentUserId: absent,
      startsOn,
      endsOn,
    })
    .returning(entry)

  return entered as SubstitutionEntry
}

/**
 * Ends a substitution, at once: from this moment the substitute sees their
 * own areas alone. One that has not begun never does.
 */
export async function endSubstitution(
  tx: TenantTransaction,
  id: string,
): Promise<{ readonly ended: string }> {
  const ended = isUuid(id)
    ? await tx
        .delete(substitutions)
        .where(eq(substitutions.id, id as Id<'substitution'>))
        .returning({ id: substitutions.id })
    : []

  if (ended.length === 0) {
    throw new NotFoundException('Diese Vertretung gibt es nicht oder nicht mehr.')
  }

  return { ended: id }
}
