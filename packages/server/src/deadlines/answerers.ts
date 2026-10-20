import type { MayAnswer, TenantTransaction } from '@opengewerk/platform-server'
import { and, inArray } from 'drizzle-orm'

import { memberAllAreas, memberAreas } from '../database/schema/index.js'

/** What of a deadline decides who may answer for it: the area it lies in, none for one in no area. */
interface InAnArea {
  readonly areaId: string | null
}

/**
 * Which of these people see which of these areas, every area or the one, in
 * two queries whatever the number of either (#473).
 */
export async function areasSeenBy(
  tx: TenantTransaction,
  people: readonly string[],
  areas: readonly string[],
): Promise<(userId: string, areaId: string) => boolean> {
  if (people.length === 0 || areas.length === 0) {
    return () => false
  }

  const everywhere = new Set(
    (
      await tx
        .select({ userId: memberAllAreas.userId })
        .from(memberAllAreas)
        .where(inArray(memberAllAreas.userId, [...people]))
    ).map((row) => row.userId),
  )
  const somewhere = new Set(
    (
      await tx
        .select({ userId: memberAreas.userId, areaId: memberAreas.areaId })
        .from(memberAreas)
        .where(
          and(
            inArray(memberAreas.userId, [...people]),
            inArray(memberAreas.areaId, [...areas] as never[]),
          ),
        )
    ).map((row) => `${row.userId}/${row.areaId}`),
  )

  return (userId, areaId) => everywhere.has(userId) || somewhere.has(`${userId}/${areaId}`)
}

/**
 * Who of the people the foundation names may answer for a deadline of this
 * application (#473): whoever sees its area, every area or this one, so that
 * nobody is reminded of a deadline in an area they do not see, with its kind,
 * its day and the way to it. A deadline in no area, the document of a firm or
 * a contract, anybody the foundation names. Whether they still work here and
 * are not blocked the foundation has asked already.
 */
export const mayAnswerForDeadlines: MayAnswer<InAnArea> = async (tx, asked) => {
  const people = [...new Set(asked.flatMap((question) => question.userIds))]
  const areas = [
    ...new Set(
      asked.flatMap((question) =>
        question.deadline.areaId === null ? [] : [question.deadline.areaId],
      ),
    ),
  ]
  const sees = await areasSeenBy(tx, people, areas)

  return asked.map(({ deadline, userIds }) => {
    const { areaId } = deadline

    return new Set(areaId === null ? userIds : userIds.filter((userId) => sees(userId, areaId)))
  })
}
