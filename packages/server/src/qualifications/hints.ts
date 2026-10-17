import {
  type Catalogue,
  type IsoDate,
  type QualificationHint,
  qualificationCheck,
  requiredKinds,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { inArray, isNull, and } from 'drizzle-orm'

import { qualifications } from '../database/schema/index.js'

/**
 * What the people offered for an activity lack of the kinds its duties ask
 * for (#337), on a day: by the person, the first kind they do not hold, and
 * whether it is missing or ran out, with its last day. Nothing for whoever
 * holds every kind, and nothing at all where the duties ask for none. A
 * note for whoever assigns, never a refusal.
 */
export async function qualificationHints(
  tx: TenantTransaction,
  catalogue: Catalogue,
  dutyKindKeys: readonly (string | null)[],
  userIds: readonly string[],
  day: IsoDate,
): Promise<Record<string, QualificationHint>> {
  const required = requiredKinds(catalogue, dutyKindKeys)

  if (required.length === 0 || userIds.length === 0) {
    return {}
  }

  const held = await tx
    .select({
      userId: qualifications.userId,
      kindKey: qualifications.kindKey,
      ownKindId: qualifications.ownKindId,
      validUntil: qualifications.validUntil,
      deletedAt: qualifications.deletedAt,
    })
    .from(qualifications)
    .where(and(inArray(qualifications.userId, [...userIds]), isNull(qualifications.deletedAt)))
  const hints: Record<string, QualificationHint> = {}

  for (const userId of userIds) {
    const theirs = held.filter((row) => row.userId === userId)

    for (const kind of required) {
      const check = qualificationCheck(theirs, kind.key, day)

      if (check !== 'held') {
        const ran = theirs
          .filter((row) => row.kindKey === kind.key && row.validUntil !== null)
          .map((row) => row.validUntil as IsoDate)
          .sort()

        hints[userId] = {
          kindLabel: kind.label,
          check,
          expiredOn: check === 'expired' ? (ran.at(-1) ?? null) : null,
        }
        break
      }
    }
  }

  return hints
}
