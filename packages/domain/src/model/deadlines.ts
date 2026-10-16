import type { DeadlineKind } from '@opengewerk/platform-domain'

import type { DocumentKind } from './document.js'

/**
 * The deadlines of this application (section 2.4 of the concept), kept by
 * the deadline engine of the foundation (ADR 0010 in the repository
 * opengewerk). A deadline is never typed in: it follows from its source and
 * drops out once the source no longer asks for it.
 */

/** The sources the deadlines of this application follow, by the name a kind gives them. */
export const deadlineSources = [
  'duty',
  'defect',
  'round_plan',
  'meter',
  'document',
  'risk_assessment',
  'contract_notice',
  'contract_end',
  'warranty',
] as const

export type DeadlineSource = (typeof deadlineSources)[number]

/**
 * The actions a kind may name. The reminder is the foundation's own. The
 * activity is this application's (#105): when the lead of a due day begins,
 * an inspection or a maintenance comes of it, once for the due day, and of
 * the plan of a round its rounds (#113), once for each pass. The task is this
 * application's as well (#242): when the lead begins, the person who answers
 * for the deadline gets something to do by the due day, at the place of the
 * deadline, and it is done once the deadline no longer waits for that day.
 *
 * Which kind names which action is decided, not open to an operator: the
 * appointment of a duty makes its activity, the plan of a round its rounds,
 * the reading of the meters its task, and a defect only reminds, because with
 * its state, its day and its work order it already has what a task would be.
 */
export const deadlineActions = ['reminder', 'activity', 'task'] as const

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
 * leads the operator is reminded when the lead begins and gets the task to
 * read them (#242), one for the property and its key date; once every meter
 * there has its reading, the deadline moves on to the next key date and the
 * task is done.
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
  actions: ['reminder', 'task'],
}

/**
 * The day a document expires (section 4.10, #327, the source "Dokumente mit
 * Ablaufdatum" of section 2.4): the source names the day the newest version
 * of a document carries, while the document is there; a new version brings
 * its own day, or none, and the deadline moves with it or drops. Whoever set
 * the day answers for it until somebody else is named, and is reminded.
 */
export const documentExpires: ApplicationDeadlineKind = {
  key: 'document.expires',
  title: 'Ablauf eines Dokuments',
  about:
    'Folgt aus dem Datum „Gültig bis“ der neuesten Fassung eines Dokuments: mit einer neuen Fassung rückt sie zu deren Datum, ohne Datum oder mit dem Dokument fällt sie weg.',
  source: 'document',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 60,
  responsible: 'source',
  actions: ['reminder'],
}

/**
 * The review of a risk assessment (sections 4.3 and 4.10, #327): the same as
 * the expiry of a document, by the day its newest version names for the
 * review. A kind of its own, so that the operator sets its reminder apart.
 */
export const riskAssessmentReview: ApplicationDeadlineKind = {
  key: 'risk_assessment.review',
  title: 'Wiedervorlage einer Gefährdungsbeurteilung',
  about:
    'Folgt aus der Wiedervorlage der neuesten Fassung einer Gefährdungsbeurteilung: mit einer neuen Fassung rückt sie zu deren Datum, ohne Datum oder mit dem Dokument fällt sie weg.',
  source: 'risk_assessment',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 30,
  responsible: 'source',
  actions: ['reminder'],
}

/**
 * The last day to give notice for the end of the term of a contract that
 * runs (section 4.11, #329, the source "Verträge" of section 2.4): the source
 * names the day the end of the term and the notice period give. It stays
 * this day after it has passed, while the term runs, and moves on with the
 * next term; with notice given or without a notice period it drops. A
 * contract has no area: whoever leads the operator answers for it unless the
 * settings name somebody else.
 */
export const contractNotice: ApplicationDeadlineKind = {
  key: 'contract.notice',
  title: 'Kündigungsfrist eines Vertrags',
  about:
    'Folgt aus dem Ende der laufenden Laufzeit und der Kündigungsfrist eines Vertrags: bis zu diesem Tag lässt er sich zum Ende kündigen. Mit der nächsten Laufzeit rückt sie weiter, mit einer Kündigung fällt sie weg.',
  source: 'contract_notice',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 60,
  responsible: 'lead',
  actions: ['reminder'],
}

/**
 * The end of the term of a contract (section 4.11, #329): the day it renews
 * or, without a renewal or once notice is given, the day it ends. Every duty
 * a contract fulfils says so once it has ended.
 */
export const contractEnd: ApplicationDeadlineKind = {
  key: 'contract.end',
  title: 'Ende oder Verlängerung eines Vertrags',
  about:
    'Folgt aus dem Ende der laufenden Laufzeit eines Vertrags: an diesem Tag verlängert er sich oder endet, wenn er gekündigt ist oder sich nicht verlängert.',
  source: 'contract_end',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 30,
  responsible: 'lead',
  actions: ['reminder'],
}

/**
 * The end of a warranty (section 4.11, #329): of an asset, by the day its
 * record names, or of an accepted work order, by the day entered at it. Both
 * lie where the asset or the order lies.
 */
export const warrantyEnds: ApplicationDeadlineKind = {
  key: 'warranty.ends',
  title: 'Ende einer Gewährleistung',
  about:
    'Folgt aus dem Tag „Gewährleistung bis“ einer Anlage oder eines abgenommenen Auftrags. Vor dem Ende lässt sich prüfen, ob ein Mangel noch unter die Gewährleistung fällt.',
  source: 'warranty',
  intervalDays: null,
  intervalMonths: null,
  leadDays: 60,
  responsible: 'lead',
  actions: ['reminder'],
}

/**
 * What the task of a deadline says, by the source of its kind (#242). Only a
 * source that stands here can name the action: the engine refuses a kind
 * that names the task without a text for it.
 */
export const deadlineTaskTitles: Readonly<Partial<Record<DeadlineSource, string>>> = {
  meter: 'Zähler ablesen',
}

/** Every kind this application knows. */
export const deadlineKinds: readonly ApplicationDeadlineKind[] = [
  dutyDue,
  defectDue,
  roundDue,
  meterDue,
  documentExpires,
  riskAssessmentReview,
  contractNotice,
  contractEnd,
  warrantyEnds,
]

/**
 * What a deadline of this application says in the list "Fristen" beside what
 * every deadline says (#104, #116, #113): the duty, the defect or the plan of
 * a round it follows, and what that hangs on, an asset, a room, a building or
 * the property itself.
 */
export type DeadlineFacts =
  | DutyDeadlineFacts
  | DefectDeadlineFacts
  | RoundDeadlineFacts
  | MeterDeadlineFacts
  | DocumentDeadlineFacts
  | ContractDeadlineFacts
  | WarrantyDeadlineFacts

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

/**
 * A deadline of a document (#327): the document by its name and kind. The
 * document of a contractor (#328) has no property: it names the contractor
 * instead, and no place.
 */
export interface DocumentDeadlineFacts extends Omit<DeadlinePlaceFacts, 'propertyId'> {
  readonly propertyId: string | null
  readonly contractor: { readonly id: string; readonly name: string } | null
  /** The contract whose document it is (#329), which has no place either. */
  readonly contract: { readonly id: string; readonly title: string } | null
  readonly follows: 'document'
  readonly attachmentId: string
  readonly title: string
  /** The kind of the document, apart from the kind of the deadline. */
  readonly documentKind: DocumentKind | null
}

/**
 * A deadline of a contract (#329), the last day to give notice or the end of
 * its term: the contract by its title and its firm, without a place.
 */
export interface ContractDeadlineFacts {
  readonly follows: 'contract'
  readonly propertyId: null
  readonly contract: { readonly id: string; readonly title: string }
  readonly contractor: { readonly id: string; readonly name: string }
}

/**
 * The end of a warranty (#329): of the asset the place names, or of an
 * accepted work order at its place.
 */
export interface WarrantyDeadlineFacts extends DeadlinePlaceFacts {
  readonly follows: 'warranty'
  readonly workOrder: {
    readonly id: string
    readonly number: string
    readonly title: string
  } | null
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
