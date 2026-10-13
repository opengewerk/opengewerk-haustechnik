import type { TenantId } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'

import type { activities } from '../database/schema/index.js'
import { notifyPush } from './occasions.js'

type ActivityId = (typeof activities.$inferSelect)['id']

/** An activity that went to somebody, as the route that saved it knows it. */
export interface Handed {
  readonly activityId: ActivityId
  /** The person it went to, or nobody. */
  readonly userId: string | null
  /** The day it is due on, by which the first of several is chosen. */
  readonly dueOn?: string | null
}

/**
 * Tells the people activities went to, after the route that saved them has
 * committed (#126, section 3 of the concept).
 *
 * Called after the transaction and never inside it: the writer asks the rows
 * whether the activity still names the person, and before the commit they
 * would not say so. Never in the way of the request either: whatever fails
 * here is written into the log, and the activity is handed out all the same.
 *
 * Nobody is told about what they handed to themselves. Where several
 * activities went to one person at once, the rounds of a week for instance,
 * the person gets one message, about the one that is due first: a telephone
 * that rings five times says no more than one that rings once.
 *
 * `immediate` names whoever leads a work order of the urgency "sofort"
 * (section 4.8): they get the message that comes whatever they switched off,
 * in place of the ordinary one.
 */
export async function tellHandedOut(
  database: Database,
  tenantId: TenantId,
  by: string,
  handed: readonly Handed[],
  immediate: { readonly activityId: ActivityId; readonly userId: string | null } | null = null,
): Promise<void> {
  const now = new Date()
  const first = new Map<string, Handed>()

  for (const one of handed) {
    if (one.userId === null || one.userId === by) {
      continue
    }

    const before = first.get(one.userId)

    if (!before || (one.dueOn ?? '9999') < (before.dueOn ?? '9999')) {
      first.set(one.userId, one)
    }
  }

  try {
    if (immediate && immediate.userId !== null && immediate.userId !== by) {
      first.delete(immediate.userId)
      await notifyPush(
        database,
        tenantId,
        { kind: 'immediate', activityId: immediate.activityId, userId: immediate.userId },
        { now },
      )
    }

    for (const [userId, one] of first) {
      await notifyPush(
        database,
        tenantId,
        { kind: 'assigned', activityId: one.activityId, userId },
        { now },
      )
    }
  } catch (error) {
    console.error('Eine Benachrichtigung über eine Zuteilung ließ sich nicht schreiben.', error)
  }
}
