import type { DeadlineKind } from '@opengewerk/platform-domain'

/**
 * The deadlines of this application (section 2.4 of the concept), kept by
 * the deadline engine of the foundation (ADR 0010 in the repository
 * opengewerk). A deadline is never typed in: it follows from its source and
 * drops out once the source no longer asks for it.
 */

/** The sources the deadlines of this application follow, by the name a kind gives them. */
export const deadlineSources = ['duty'] as const

export type DeadlineSource = (typeof deadlineSources)[number]

/**
 * The actions a kind may name. The reminder is the foundation's own; the
 * others of section 2.4, a task and an activity, come with what they make.
 */
export const deadlineActions = ['reminder'] as const

export type DeadlineAction = (typeof deadlineActions)[number]

/** A kind of deadline of this application. */
export type ApplicationDeadlineKind = DeadlineKind<DeadlineSource, DeadlineAction>

/**
 * The appointment of a duty (ADR 0002, point 12): the source names the due
 * day, counted from the last evidence that met the duty, with the interval
 * and the counting of the duty. The lead is the default until a tenant sets
 * its own for the kind, and the responsible person is the one the duty
 * names, else whoever leads the tenant.
 */
export const dutyDue: ApplicationDeadlineKind = {
  key: 'duty.due',
  title: 'Fälligkeit einer Pflicht',
  about:
    'Folgt aus dem letzten Nachweis einer Pflicht und ihrer Frist, ruht mit ihrer Anlage und fällt weg, wenn die Pflicht endet.',
  source: 'duty',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 30,
  responsible: 'source',
  actions: ['reminder'],
}

/** Every kind this application knows. */
export const deadlineKinds: readonly ApplicationDeadlineKind[] = [dutyDue]
