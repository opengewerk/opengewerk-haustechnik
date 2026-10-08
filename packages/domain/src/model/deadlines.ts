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
 * The actions a kind may name. The reminder is the foundation's own. The
 * activity is this application's (#105): when the lead of a due day begins,
 * an inspection or a maintenance comes of it, once for the due day. The task
 * of section 2.4 comes with the tasks.
 */
export const deadlineActions = ['reminder', 'activity'] as const

export type DeadlineAction = (typeof deadlineActions)[number]

/** A kind of deadline of this application. */
export type ApplicationDeadlineKind = DeadlineKind<DeadlineSource, DeadlineAction>

/**
 * The appointment of a duty (ADR 0002, point 12): the source names the due
 * day, counted from the last evidence that met the duty, with the interval
 * and the counting of the duty. The lead is the default until a tenant sets
 * its own for the kind, and the responsible person is the one the duty
 * names, else whoever leads the tenant. When the lead begins, the
 * responsible person is reminded and the activity that is to meet the duty
 * comes into being, with them (section 4.4 of the concept).
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
  actions: ['reminder', 'activity'],
}

/** Every kind this application knows. */
export const deadlineKinds: readonly ApplicationDeadlineKind[] = [dutyDue]

/**
 * What a deadline of this application says in the list "Fristen" beside what
 * every deadline says (#104): the duty it follows, by its title, and what the
 * duty hangs on, an asset, a room, a building or the property itself.
 */
export interface DutyDeadlineFacts {
  readonly dutyId: string
  readonly dutyTitle: string
  readonly propertyId: string
  /** The building the duty hangs on, or the one its asset stands in. */
  readonly buildingId: string | null
  readonly roomId: string | null
  readonly asset: {
    readonly id: string
    readonly number: string | null
    readonly name: string
  } | null
}

/**
 * The filters of the list "Fristen" beside kind and person, by their names
 * in the address (#75): the property and the area a deadline lies in.
 */
export const deadlineFilters = ['property', 'area'] as const

export type DeadlineFilterName = (typeof deadlineFilters)[number]
