import { type ApplicationDeadlineKind, deadlineTaskTitles } from '@opengewerk/haustechnik-domain'
import type { DeadlineActionHandler, TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'

import { deadlines, tasks } from '../database/schema/index.js'
import { taskCandidatesIn } from './candidates.js'

/** A deadline of this application as the engine hands it to an action. */
type DeadlineRow = typeof deadlines.$inferSelect

/**
 * The action "task" of a deadline (#242, section 2.4 of the concept): when
 * the lead of a due day begins, whoever answers for the deadline gets
 * something to do by that day, at the property of the deadline. What it says
 * comes from the source of the kind (`deadlineTaskTitles`); today only the
 * reading of the meters of a property names the action.
 *
 * One task at a time: the deadline names the task made of it (`task_id`).
 * The engine of the foundation calls an action once for a due day, and a
 * deadline whose task is still to be done gets no second one when its due day
 * moves: the task it has follows to the new day.
 *
 * The person is asked as the sync asks (`taskCandidatesIn`): somebody who is
 * shut out, may not do tasks or does not see the area of the deadline gets
 * none, because it would be a task they cannot see. The deadline then stands
 * in the list of the office as before, and nothing here fails: a pass that
 * failed over it would try again every minute.
 *
 * Written in the transaction of a pass, which works for nobody: the task
 * names nobody who wrote it (`record_task_author`).
 *
 * The task hangs on the property and carries the area of the deadline. That
 * holds while the meters of a property, whose deadline hangs on the property
 * itself, are the only source that names the action: a task on the property
 * follows the area of the property (ADR 0003, addendum of #306). A source
 * with a place, a duty at an asset in a building with an area of its own,
 * needs the task at that place, or the key of the task refuses it.
 */
export function taskFromDeadline(): DeadlineActionHandler<ApplicationDeadlineKind, DeadlineRow> {
  return async ({ tx, tenantId, kind, deadline, responsible, now }) => {
    const title = deadlineTaskTitles[kind.source]

    if (title === undefined) {
      throw new Error(
        `The deadline kind ${kind.key} names the action task, which has no text for it`,
      )
    }

    if (deadline.taskId !== null) {
      const [held] = await tx
        .select({ id: tasks.id, dueOn: tasks.dueOn })
        .from(tasks)
        .where(
          and(
            eq(tasks.tenantId, tenantId),
            eq(tasks.id, deadline.taskId),
            eq(tasks.status, 'open'),
            isNull(tasks.deletedAt),
          ),
        )

      if (held !== undefined) {
        if (held.dueOn !== deadline.dueOn) {
          await tx
            .update(tasks)
            .set({ dueOn: deadline.dueOn, updatedAt: now })
            .where(eq(tasks.id, held.id))
        }

        return
      }
    }

    // A deadline without a place, of a contractor's document (#328), has nowhere for a task to hang.
    if (
      responsible === null ||
      deadline.propertyId === null ||
      deadline.areaId === null ||
      !(await taskCandidatesIn(tx, deadline.areaId)).includes(responsible)
    ) {
      return
    }

    const [made] = await tx
      .insert(tasks)
      .values({
        tenantId,
        title,
        dueOn: deadline.dueOn,
        assigneeUserId: responsible,
        propertyId: deadline.propertyId,
        areaId: deadline.areaId,
      })
      .returning({ id: tasks.id })

    if (made !== undefined) {
      await tx.update(deadlines).set({ taskId: made.id }).where(eq(deadlines.id, deadline.id))
    }
  }
}

/**
 * Marks the tasks done whose deadline no longer waits for the day they were
 * made for (#242): the deadline has moved on to a later day, which for the
 * meters of a property means that every one of them has its reading for the
 * key date, or it has dropped out, because nothing there is to be read any
 * more.
 *
 * Asked of the deadline and not of the task: `reminded_for` is the due day
 * the engine made the task for, so a task whose day somebody changed by hand
 * is done at the same moment as any other. A task that was done or removed by
 * hand is left as it is, and nothing here opens one again.
 *
 * Run at the end of the pass that follows the sources, in its transaction:
 * the task is done in the pass in which its deadline moves.
 */
export async function settleDeadlineTasks(tx: TenantTransaction, now: Date): Promise<void> {
  const settled = await tx
    .select({ id: tasks.id })
    .from(deadlines)
    .innerJoin(tasks, and(eq(tasks.tenantId, deadlines.tenantId), eq(tasks.id, deadlines.taskId)))
    .where(
      and(
        eq(tasks.status, 'open'),
        isNull(tasks.deletedAt),
        or(ne(deadlines.status, 'open'), gt(deadlines.dueOn, deadlines.remindedFor)),
      ),
    )

  if (settled.length === 0) {
    return
  }

  await tx
    .update(tasks)
    .set({ status: 'done', updatedAt: now })
    .where(
      inArray(
        tasks.id,
        settled.map((row) => row.id),
      ),
    )
}
