import type { TaskCandidates } from '@opengewerk/haustechnik-domain'
import { Controller, Get } from '@nestjs/common'
import { accountsOf, CurrentIdentity, Database } from '@opengewerk/platform-server'

import { areasInSight } from '../areas/areas.js'
import { taskCandidatesIn } from '../tasks/candidates.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/**
 * What the tasks need beyond their rows (#124). The rows travel through the
 * sync, in the office as on site: a task is written and done without a
 * network as well. What does not travel is who can be given one. The people
 * of an operator live in its memberships and accounts, which never go to a
 * device, so their names come from here, while there is a connection.
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly database: Database) {}

  /**
   * Who a task may go to, in each area of the person asking: the people who
   * may do tasks, are not shut out and see the area, by name and nothing
   * else. For whoever hands tasks out, and nobody else: whoever writes a task
   * only for themselves needs no list of the others.
   */
  @Get('candidates')
  @RequiresPermission('task.assign')
  async candidates(@CurrentIdentity() identity: Asking): Promise<TaskCandidates> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const areas = await areasInSight(tx)

      return Promise.all(
        areas.map(async (area) => ({
          areaId: area.id,
          userIds: await taskCandidatesIn(tx, area.id),
        })),
      )
    })
    const accounts = await accountsOf(
      this.database,
      [...new Set(found.flatMap((area) => area.userIds))],
      identity.userId,
    )

    return {
      areas: found.map((area) => ({
        areaId: area.areaId,
        people: area.userIds
          .map((userId) => ({ userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }))
          .sort((left, right) => left.name.localeCompare(right.name, 'de')),
      })),
    }
  }
}
