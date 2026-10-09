import type { DeadlineKind } from '@opengewerk/platform-domain'

/**
 * The deadlines of this application (section 2.4 of the concept), kept by
 * the deadline engine of the foundation (ADR 0010 in the repository
 * opengewerk). A deadline is never typed in: it follows from its source and
 * drops out once the source no longer asks for it.
 */

/** The sources the deadlines of this application follow, by the name a kind gives them. */
export const deadlineSources = ['duty', 'defect', 'round_plan', 'meter'] as const

export type DeadlineSource = (typeof deadlineSources)[number]

/**
 * The actions a kind may name. The reminder is the foundation's own. The
 * activity is this application's (#105): when the lead of a due day begins,
 * an inspection or a maintenance comes of it, once for the due day, and of
 * the plan of a round its rounds (#113), once for each pass. The task of
 * section 2.4 comes with the tasks.
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

/**
 * The day a defect is to be set right by (section 4.6, #116): the source
 * names the day the defect says, while it waits to be set right; once it is
 * remedied, the deadline drops. A defect names nobody, so whoever leads the
 * operator is reminded when the lead begins.
 */
export const defectDue: ApplicationDeadlineKind = {
  key: 'defect.due',
  title: 'Frist zur Beseitigung eines Mangels',
  about:
    'Folgt aus der Frist, die ein Mangel nennt, solange er festgestellt oder beauftragt ist, und fällt weg, sobald er behoben ist.',
  source: 'defect',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 7,
  responsible: 'lead',
  actions: ['reminder'],
}

/**
 * The next pass of the plan of a round (section 4.5, #113): the source names
 * the first day the plan falls due on that has no round yet. When the lead
 * begins, the rounds of the plan as far as the lead reaches come into being,
 * each pass once. Whoever leads the operator answers for the deadline: the
 * person a plan names walks its rounds and plans nothing. Nobody is reminded: a round is a task of the week, which the
 * overview of the rounds shows, and a reminder for every daily round would
 * bury whatever else is due.
 *
 * The lead is how far ahead the rounds are made, so that the office can hand
 * out those of the coming week before it begins.
 */
export const roundDue: ApplicationDeadlineKind = {
  key: 'round.due',
  title: 'Rundgang nach Plan',
  about:
    'Folgt aus dem Plan eines Rundgangs: der nächste Durchgang, für den noch kein Rundgang entstanden ist. Mit dem Vorlauf entstehen die Rundgänge, jeder Durchgang einmal.',
  source: 'round_plan',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 14,
  responsible: 'lead',
  actions: ['activity'],
}

/**
 * The reading of the meters of a property for their key date (section 4.9,
 * #120, the source "Zählerablesung zum Stichtag" of section 2.4): the source
 * names the earliest key date for which a measuring point there has no
 * reading, leaving out one that is locked and a key date it rests on. One
 * deadline for the meters of a property, not one per meter: they are read on
 * one round, and a reminder for every meter would bury the rest. Whoever
 * leads the operator is reminded when the lead begins; once every meter
 * there has its reading, the deadline moves on to the next key date.
 */
export const meterDue: ApplicationDeadlineKind = {
  key: 'meter.due',
  title: 'Zählerablesung zum Stichtag',
  about:
    'Folgt aus dem Stichtag der Zähler einer Liegenschaft: der früheste Stichtag, für den eine Messstelle dort noch keinen Stand hat, ohne gesperrte und ohne die Tage, an denen eine ruht.',
  source: 'meter',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 3,
  responsible: 'lead',
  actions: ['reminder'],
}

/** Every kind this application knows. */
export const deadlineKinds: readonly ApplicationDeadlineKind[] = [
  dutyDue,
  defectDue,
  roundDue,
  meterDue,
]

/**
 * What a deadline of this application says in the list "Fristen" beside what
 * every deadline says (#104, #116, #113): the duty, the defect or the plan of
 * a round it follows, and what that hangs on, an asset, a room, a building or
 * the property itself.
 */
export type DeadlineFacts =
  DutyDeadlineFacts | DefectDeadlineFacts | RoundDeadlineFacts | MeterDeadlineFacts

/** A deadline of a duty: the duty by its title. */
export interface DutyDeadlineFacts extends DeadlinePlaceFacts {
  readonly follows: 'duty'
  readonly dutyId: string
  readonly dutyTitle: string
}

/** A deadline of a defect: the defect by its description. */
export interface DefectDeadlineFacts extends DeadlinePlaceFacts {
  readonly follows: 'defect'
  readonly defectId: string
  readonly description: string
}

/** A deadline of the plan of a round: the plan, by the title of its template and its rhythm. */
export interface RoundDeadlineFacts extends DeadlinePlaceFacts {
  readonly follows: 'round'
  readonly roundPlanId: string
  readonly title: string
  readonly rhythm: string
}

/** A deadline of the meters of a property: the property, which `propertyId` names. */
export interface MeterDeadlineFacts extends DeadlinePlaceFacts {
  readonly follows: 'meter'
}

/** What the duty, the defect or the plan of a deadline hangs on. */
export interface DeadlinePlaceFacts {
  readonly propertyId: string
  /** The building it hangs on, or the one its asset stands in. */
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
