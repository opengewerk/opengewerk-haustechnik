import {
  type Identity,
  isAllowed,
  mayChangeTask,
  mayNameForTask,
  missingRight,
} from '@opengewerk/haustechnik-domain'
import type { FoundIdentity, SyncCheck } from '@opengewerk/platform-server'

import { taskCandidatesIn } from '../tasks/candidates.js'

type Check = SyncCheck<FoundIdentity<Identity>>

/**
 * Who a task may go to and who may change one (#124, section 7 of the
 * concept), asked after its place is known.
 *
 * Everybody who does tasks writes them for themselves and does their own.
 * Naming somebody else, and changing a task of somebody else's, asks the
 * right to hand tasks out; without it the transmission is refused over this
 * operation with the right it lacks, the answer to any operation a person may
 * not send. The person a task goes to is somebody who may do tasks, is not
 * shut out and sees the area of the task: anybody else would be a task they
 * cannot see, or one nobody does. That is a conflict about this one task,
 * with the field, so that the rest of the outbox lands.
 */
export const handedOut: Check = async ({ tx, operation, values, current, sender }) => {
  if (operation.entity !== 'tasks') {
    return null
  }

  const handsOut = isAllowed(sender, 'task.assign')

  if (operation.kind !== 'create') {
    const assigneeUserId = String(current?.['assigneeUserId'] ?? '')

    return mayChangeTask(sender.userId, { assigneeUserId }, handsOut)
      ? null
      : { kind: 'client', message: missingRight('task.assign') }
  }

  const assignee = values['assigneeUserId']

  if (typeof assignee !== 'string' || assignee === '') {
    return { kind: 'conflict', reason: 'record_missing', fields: ['assigneeUserId'] }
  }

  if (!mayNameForTask(sender.userId, assignee, handsOut)) {
    return { kind: 'client', message: missingRight('task.assign') }
  }

  const candidates = await taskCandidatesIn(tx, String(values['areaId']))

  return candidates.includes(assignee)
    ? null
    : { kind: 'conflict', reason: 'record_missing', fields: ['assigneeUserId'] }
}
