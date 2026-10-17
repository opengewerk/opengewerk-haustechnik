import type { Right } from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { beforeItsEnd } from '@opengewerk/platform-server'
import { and, isNull, sql } from 'drizzle-orm'

import { memberAllAreas, memberAreas, memberships, tenantRoles } from '../database/schema/index.js'

/** The right a person needs to be the one a task is for. */
const doesTasks: Right = 'task.record'

/**
 * Who a task in an area may go to (#124, section 7 of the concept): a person
 * of the operator who is not shut out, may do tasks and sees the area, for
 * every area or for this one. A task given to anybody else would be one they
 * cannot see, or one nobody does.
 *
 * Read in the transaction of the person asking, from the memberships of the
 * operator and not from its accounts.
 */
export async function taskCandidatesIn(
  tx: TenantTransaction,
  areaId: string,
): Promise<readonly string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        isNull(memberships.blockedAt),
        beforeItsEnd(),
        sql`exists (
          select 1 from ${tenantRoles}
           where ${tenantRoles.tenantId} = ${memberships.tenantId}
             and ${tenantRoles.key} = any(${memberships.roles})
             and ${doesTasks} = any(${tenantRoles.rights}))`,
        sql`(exists (select 1 from ${memberAllAreas}
                      where ${memberAllAreas.tenantId} = ${memberships.tenantId}
                        and ${memberAllAreas.userId} = ${memberships.userId})
             or exists (select 1 from ${memberAreas}
                         where ${memberAreas.tenantId} = ${memberships.tenantId}
                           and ${memberAreas.userId} = ${memberships.userId}
                           and ${memberAreas.areaId} = ${areaId}))`,
      ),
    )

  return rows.map((row) => row.userId).sort()
}
