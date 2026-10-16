import type { Id } from '@opengewerk/platform-domain'

import type { ActivityStatus, WorkOrderId } from './activity.js'
import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import { type Problems, required } from './fields.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'
import { placeTargetFields } from './target.js'

/**
 * A fault report (section 4.7 of the concept, #331): somebody who works or
 * lives in a building says that something does not work, with a category, a
 * description and a photo, at a building, a room or an asset. Whoever accepts
 * faults in its area accepts it, which makes a work order of the kind
 * "Störung", merges it with another report of the same fault, or rejects it
 * with a reason.
 *
 * A report names nobody, not even in the inbox: who reported it stands in the
 * change log, as with a defect (sections 4.6 and 9 of the concept). The row
 * keeps who reported it, for the own list and for the feedback, and no answer
 * of the inbox carries that column.
 */
export type FaultReportId = Id<'fault-report'>

/** A category the operator keeps for the reports (decided 15.10.2026). */
export type FaultCategoryId = Id<'fault-category'>

/**
 * The categories the first start proposes; the operator renames, adds and
 * removes them under "Einstellungen" (section 4.7 of the concept).
 */
export const proposedFaultCategories = [
  'Elektro',
  'Heizung und Lüftung',
  'Sanitär',
  'Aufzug',
  'Türen und Schlösser',
  'Sonstiges',
] as const

/**
 * Where a report stands. Received until somebody decides on it; accepted
 * once its work order exists; done with the signature under that order;
 * rejected with the reason; merged into another report, whose state it
 * follows from then on (section 4.7 of the concept).
 */
export const faultReportStates = ['received', 'accepted', 'done', 'rejected', 'merged'] as const

export type FaultReportState = (typeof faultReportStates)[number]

export const faultReportStateLabel: Readonly<Record<FaultReportState, string>> = {
  received: 'Eingegangen',
  accepted: 'Angenommen',
  done: 'Erledigt',
  rejected: 'Abgelehnt',
  merged: 'Zusammengeführt',
}

/** The bounds of the texts of a report, the same in the form, the route and the database. */
export const faultReportLimits = {
  description: 2000,
  reason: 1000,
  category: 80,
} as const

/**
 * A report at its place, as the inbox and the own list read it: in a building
 * always, and at a room or an asset there where one was chosen. Unlike a
 * defect it never hangs on a property alone, and so it names its building
 * even at a room or an asset: two reports of one fault meet in it.
 */
export interface FaultReport {
  readonly id: FaultReportId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly buildingId: BuildingId
  readonly roomId: RoomId | null
  readonly assetId: AssetId | null
  readonly categoryId: FaultCategoryId
  readonly description: string
  readonly receivedAt: string
  /** The work order accepting it made; a new acceptance after an order not performed names the new one. */
  readonly workOrderId: WorkOrderId | null
  readonly rejectedAt: string | null
  readonly rejectionReason: string | null
  readonly mergedIntoId: FaultReportId | null
}

/**
 * The state of a report from what it holds and from the status of its work
 * order. Done is the signature under the order (decided 15.10.2026): a
 * signed order and one accepted after it. An order closed as not performed
 * puts the report back into the inbox, as it puts a defect back to found
 * (section 4.8 of the concept); one rejected at the acceptance is under way
 * again and so is the report.
 */
export function faultReportState(
  report: Pick<FaultReport, 'workOrderId' | 'rejectedAt' | 'mergedIntoId'>,
  orderStatus: ActivityStatus | null,
): FaultReportState {
  if (report.rejectedAt !== null) {
    return 'rejected'
  }

  if (report.mergedIntoId !== null) {
    return 'merged'
  }

  if (report.workOrderId === null || orderStatus === null || orderStatus === 'not_performed') {
    return 'received'
  }

  return orderStatus === 'signed' || orderStatus === 'done' ? 'done' : 'accepted'
}

/** Whether a report still waits for a decision of whoever accepts faults. */
export function awaitsDecision(state: FaultReportState): boolean {
  return state === 'received'
}

/**
 * What is wrong with a new report, field by field: a category, a description
 * and exactly one place, a building, a room or an asset; the server finds the
 * building of a room or an asset itself. A report at the property alone says
 * nothing anybody could go to.
 */
export function faultReportProblems(report: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, report, 'description', faultReportLimits.description, 'Die Beschreibung')

  if (typeof report['categoryId'] !== 'string' || report['categoryId'] === '') {
    problems['categoryId'] = 'Die Kategorie fehlt.'
  }

  const named = placeTargetFields.filter(
    (field) => report[field] !== undefined && report[field] !== null,
  )

  if (named.length !== 1) {
    problems['place'] =
      'Eine Störung hängt an genau einem: einem Gebäude, einem Raum oder einer Anlage.'
  }

  return problems
}

/** What is wrong with a rejection: the reason, which the person who reported reads. */
export function faultRejectionProblems(
  body: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  required(
    problems,
    { reason: body['reason'] ?? null },
    'reason',
    faultReportLimits.reason,
    'Der Grund',
  )

  return problems
}

/** What is wrong with the name of a category. */
export function faultCategoryProblems(body: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, { name: body['name'] ?? null }, 'name', faultReportLimits.category, 'Der Name')

  return problems
}

/**
 * Whether a report may be merged into another (section 4.7 of the concept):
 * one report into a different one of the same building that is neither done
 * nor rejected nor merged itself, and only one that still waits for a
 * decision. A report at a building without a room stands in that building.
 * The sentence says why not, or it is null.
 */
export function mergeProblem(
  report: {
    readonly id: string
    readonly buildingOf: string | null
    readonly state: FaultReportState
  },
  into: {
    readonly id: string
    readonly buildingOf: string | null
    readonly state: FaultReportState
  },
): string | null {
  if (report.state !== 'received') {
    return 'Zusammenführen lässt sich nur eine Meldung, die noch im Eingang steht.'
  }

  if (report.id === into.id) {
    return 'Eine Meldung lässt sich nicht mit sich selbst zusammenführen.'
  }

  if (into.state !== 'received' && into.state !== 'accepted') {
    return 'Zusammengeführt wird mit einer Meldung, die weder erledigt noch abgelehnt ist.'
  }

  if (report.buildingOf === null || report.buildingOf !== into.buildingOf) {
    return 'Zusammengeführt wird nur mit einer Meldung aus demselben Gebäude.'
  }

  return null
}

/** A category as the form of a report and the settings read it. */
export interface FaultCategory {
  readonly id: FaultCategoryId
  readonly name: string
  /** How many reports carry it, for the settings; the form does not ask. */
  readonly reports?: number
}

/**
 * Where a report hangs, by the names a person who reports sees (section 4.7
 * of the concept): the building always, and the room, or for an asset the
 * room it stands in. An asset itself is never named to a Melder.
 */
export interface FaultPlaceWords {
  readonly property: string
  readonly building: string
  readonly room: string | null
}

/** A building of the own areas with its rooms, by their names only, to report at. */
export interface FaultPlaceChoice {
  readonly buildingId: BuildingId
  readonly property: string
  readonly building: string
  readonly rooms: readonly { readonly id: RoomId; readonly name: string; readonly floor: string }[]
}

/**
 * What a scanned label is to somebody who reports: a place in the own areas,
 * or one word as for every other scan (`blocked`, `outside`, `unknown`), and
 * `unassigned` for a label of a sheet that hangs on nothing yet.
 */
export type FaultLabelAnswer =
  | {
      readonly standing: 'open'
      readonly place: {
        readonly buildingId: BuildingId
        readonly roomId: RoomId | null
        readonly assetId: AssetId | null
      }
      readonly words: FaultPlaceWords
    }
  | { readonly standing: 'blocked' | 'outside' | 'unknown' | 'unassigned' }

/** An own report as the list of the person who reported it shows it, with its state and nothing behind it. */
export interface OwnFaultReport {
  readonly id: FaultReportId
  readonly category: string
  readonly description: string
  readonly words: FaultPlaceWords
  readonly receivedAt: string
  readonly state: FaultReportState
  readonly acceptedAt: string | null
  /** When its work order was signed, for a report that is done. */
  readonly doneAt: string | null
  readonly rejectionReason: string | null
  readonly hasPhoto: boolean
}

/** A report in the inbox: what was reported, where, when and how it stands, and no person. */
export interface FaultReportEntry {
  readonly id: FaultReportId
  readonly category: string
  readonly description: string
  readonly words: FaultPlaceWords
  readonly propertyId: PropertyId
  readonly buildingId: BuildingId
  readonly roomId: RoomId | null
  readonly areaId: AreaId
  readonly assetId: AssetId | null
  readonly assetName: string | null
  readonly receivedAt: string
  readonly state: FaultReportState
  readonly workOrder: { readonly activityId: string; readonly number: string | null } | null
  /** Whether it came in over a label without an account (#332): it names nobody either way. */
  readonly outside: boolean
}

/** The page of a report in the office: the entry, its photo, the reports merged into it and those it may be merged with. */
export interface FaultReportPage extends FaultReportEntry {
  readonly hasPhoto: boolean
  readonly acceptedAt: string | null
  readonly rejectedAt: string | null
  readonly rejectionReason: string | null
  readonly mergedInto: FaultReportEntry | null
  readonly merged: readonly FaultReportEntry[]
  /** Reports of the same building still in the inbox or accepted, to merge this one with. */
  readonly similar: readonly FaultReportEntry[]
  readonly workOrderTitle: string | null
  readonly defectId: string | null
  /**
   * Whether somebody without an account waits for an answer by mail (#332).
   * The address itself is answered to nobody.
   */
  readonly answersByMail: boolean
}

/** The states the inbox filters by, in the order of its chips. */
export const faultInboxFilters = ['received', 'accepted', 'done', 'rejected', 'all'] as const

export type FaultInboxFilter = (typeof faultInboxFilters)[number]

/** How a place is said in one line: "Schulhaus, 2.05 Lehrerzimmer". */
export function faultPlaceLine(words: FaultPlaceWords): string {
  return words.room === null ? words.building : `${words.building}, ${words.room}`
}

/**
 * What an operator sets for its fault reports (#332): whether the label at a
 * room or an asset takes a report from somebody without an account. Shipped
 * off, and the Leitung switches it on under "Einstellungen" (decided
 * 15.10.2026).
 */
export interface FaultReportSettings {
  readonly openByLabel: boolean
}

export const defaultFaultReportSettings: FaultReportSettings = { openByLabel: false }

/** What is wrong with the settings of the fault reports: a yes or a no. */
export function faultReportSettingsProblems(
  body: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  return typeof body['openByLabel'] === 'boolean'
    ? {}
    : { openByLabel: 'Ob das Etikett ohne Anmeldung zum Melden öffnet, ist ein Ja oder ein Nein.' }
}

/**
 * The page of a label for somebody without an account (section 4.7 of the
 * concept, #332, decided 15.10.2026): no captcha and no service of a third
 * party, but a limit per label and per address, a field nobody sees, and a
 * least time between opening the page and sending it.
 */
export const outsideReportRules = {
  /** Reports per hour from one address, over any label. */
  perAddress: 5,
  /** Reports per hour over one label, from anywhere; counted for a code as written, known or not. */
  perLabel: 10,
  /** Openings of the page per hour from one address. */
  pagesPerAddress: 60,
  /** Seconds a form is open at least before what it sends counts. */
  leastSeconds: 3,
  /** Hours a form stays good. */
  mostHours: 24,
  /** Minutes the photo of a report can follow it. */
  photoMinutes: 15,
  /** The largest photo the page takes, smaller than a file of somebody signed in. */
  photoBytes: 10_000_000,
  /** The longest address for an answer. */
  address: 254,
} as const

/** What the page says of a label that takes no report: unknown, blocked, switched off or on nothing alike. */
export const closedLabelSentence =
  'Über dieses Etikett lässt sich ohne Anmeldung nichts melden. Wer ein Konto hat, meldet sich an und kommt so zum Raum oder zur Anlage.'

/** What the page says once the limit per label or per address is reached. */
export const tooManyReportsSentence =
  'Über dieses Etikett oder von diesem Anschluss kamen in kurzer Zeit viele Meldungen. Versuchen Sie es in einer Stunde noch einmal.'

/** What the page says of a form that was open too long, or before the server last started. */
export const staleFormSentence =
  'Die Seite war zu lange offen. Laden Sie sie neu und melden Sie noch einmal.'

/**
 * What the page of a label is told: nothing but that it is closed, whatever
 * the reason; or, open, the name of the room on the label (for an asset the
 * room it stands in, none where it stands in no room), the categories, and
 * the form it sends back, which carries when it was opened.
 */
export type OutsideLabelPage =
  | { readonly open: false }
  | {
      readonly open: true
      readonly room: string | null
      readonly categories: readonly FaultCategory[]
      readonly form: string
    }

/** What answers a report without an account: where its photo may follow, if it has one. */
export interface OutsideReportReceipt {
  readonly photo: string | null
}

/**
 * Whether an address for an answer looks like one: something, one at sign,
 * a domain with a dot. Whether it reaches anybody only the mail shows.
 */
export function looksLikeAnAddress(value: string): boolean {
  return value.length <= outsideReportRules.address && /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value)
}

/**
 * What is wrong with a report without an account, field by field: a category
 * and a description as with an account, and an address for the answer only if
 * somebody gives one. The place is the label's and is not sent.
 */
export function outsideReportProblems(body: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, body, 'description', faultReportLimits.description, 'Die Beschreibung')

  if (typeof body['categoryId'] !== 'string' || body['categoryId'] === '') {
    problems['categoryId'] = 'Die Kategorie fehlt.'
  }

  const contact = body['contact']

  if (contact !== undefined && contact !== null && contact !== '') {
    if (typeof contact !== 'string' || !looksLikeAnAddress(contact.trim())) {
      problems['contact'] = 'Das sieht nicht nach einer E-Mail-Adresse aus.'
    }
  }

  return problems
}
