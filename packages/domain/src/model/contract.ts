import { addDays, addMonths, type Id, type IsoDate, type Synced } from '@opengewerk/platform-domain'

import type { ContractorId } from './contractor.js'
import type { DutyEntry } from './duty-register.js'
import { calendarDay, optional, type Problems, required, wholeFromTo } from './fields.js'

/**
 * A contract with a contractor (section 4.11 of the concept, #329): the firm,
 * what it covers, the duties it fulfils, its term with how it renews and the
 * notice it takes, and what it says about the response time and the price,
 * both only as words the application does not count with. Tenant-wide and
 * without an area like the firm (decided 15.10.2026); what it covers is
 * shown only from the areas of whoever reads. The Leitung, the Technische
 * Leitung and the Objektleitung read the contracts, the Leitung and the
 * Technische Leitung keep them.
 *
 * The last day to give notice and the end of the term are deadlines of the
 * source "Verträge" (2.4). A contract that has ended stays readable, and every
 * duty it fulfils says so ("Vertrag abgelaufen"); one entered by mistake is
 * marked removed (`deletedAt`) while no open duty names it.
 */
export type ContractId = Id<'contract'>

/** How a notice period is counted. */
export const noticeUnits = ['weeks', 'months'] as const

export type NoticeUnit = (typeof noticeUnits)[number]

export const noticeUnitLabel: Readonly<Record<NoticeUnit, string>> = {
  weeks: 'Wochen',
  months: 'Monate',
}

export interface Contract extends Synced {
  readonly id: ContractId
  readonly contractorId: ContractorId
  readonly title: string
  readonly startsOn: IsoDate
  /** The end of the first term, or none for a contract without an end. */
  readonly endsOn: IsoDate | null
  /** By how many months it renews when nobody gives notice, or none: it ends. */
  readonly renewalMonths: number | null
  readonly noticeAmount: number | null
  readonly noticeUnit: NoticeUnit | null
  /** The day it ends since somebody gave notice; it renews no more. */
  readonly cancelledTo: IsoDate | null
  readonly responseTime: string | null
  readonly price: string | null
  readonly note: string | null
}

/** The bounds of a contract, the same in the form, the route and the database. */
export const contractLimits = {
  title: 120,
  responseTime: 120,
  price: 120,
  note: 500,
  renewalMonths: 120,
  noticeAmount: 99,
} as const

/** What a term is counted from: the fields of a contract that say how long it runs. */
export type ContractTerm = Pick<
  Contract,
  'startsOn' | 'endsOn' | 'renewalMonths' | 'noticeAmount' | 'noticeUnit' | 'cancelledTo'
>

const optionalTexts = [
  ['responseTime', 'Die Reaktionszeit'],
  ['price', 'Der Preis'],
  ['note', 'Die Notiz'],
] as const

/**
 * What is wrong with a contract, one sentence per field, empty when nothing
 * is. Undefined is a field that was not given, as in a change of other
 * fields; what the fields say together is asked of the whole only
 * (`contractTermProblems`).
 */
export function contractProblems(contract: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, contract, 'title', contractLimits.title, 'Die Bezeichnung')

  for (const [field, subject] of optionalTexts) {
    const most = contractLimits[field]

    optional(problems, contract, field, most, `${subject} hat höchstens ${String(most)} Zeichen.`)
  }

  if (contract['startsOn'] !== undefined && !calendarDay(contract['startsOn'])) {
    problems['startsOn'] = 'Der Beginn ist ein Tag, geschrieben 2026-10-03.'
  }

  for (const [field, subject] of [
    ['endsOn', 'Das Ende der Laufzeit'],
    ['cancelledTo', 'Der Tag der Kündigung'],
  ] as const) {
    const value = contract[field]

    if (value !== undefined && value !== null && !calendarDay(value)) {
      problems[field] = `${subject} ist ein Tag, geschrieben 2026-10-03.`
    }
  }

  const renewal = contract['renewalMonths']

  if (
    renewal !== undefined &&
    renewal !== null &&
    !wholeFromTo(renewal, 1, contractLimits.renewalMonths)
  ) {
    problems['renewalMonths'] =
      `Die Verlängerung ist eine ganze Zahl von 1 bis ${String(contractLimits.renewalMonths)} Monaten.`
  }

  const notice = contract['noticeAmount']

  if (
    notice !== undefined &&
    notice !== null &&
    !wholeFromTo(notice, 1, contractLimits.noticeAmount)
  ) {
    problems['noticeAmount'] =
      `Die Kündigungsfrist ist eine ganze Zahl von 1 bis ${String(contractLimits.noticeAmount)}.`
  }

  const unit = contract['noticeUnit']

  if (unit !== undefined && unit !== null && !(noticeUnits as readonly unknown[]).includes(unit)) {
    problems['noticeUnit'] = 'Die Kündigungsfrist zählt in Wochen oder Monaten.'
  }

  return problems
}

/**
 * What is wrong with the term of a whole contract, as it stands after a
 * change: an end before the beginning, a renewal without an end, a notice
 * period without its unit, a notice before the beginning.
 */
export function contractTermProblems(term: ContractTerm): Readonly<Problems> {
  const problems: Problems = {}

  if (term.endsOn !== null && term.endsOn < term.startsOn) {
    problems['endsOn'] = 'Das Ende der Laufzeit liegt nicht vor dem Beginn.'
  }

  if (term.renewalMonths !== null && term.endsOn === null) {
    problems['renewalMonths'] = 'Verlängern kann sich nur ein Vertrag mit einem Ende der Laufzeit.'
  }

  if ((term.noticeAmount === null) !== (term.noticeUnit === null)) {
    problems['noticeAmount'] = 'Eine Kündigungsfrist hat eine Zahl und ihre Einheit.'
  }

  if (term.cancelledTo !== null && term.cancelledTo < term.startsOn) {
    problems['cancelledTo'] = 'Gekündigt wird ein Vertrag nicht zu einem Tag vor seinem Beginn.'
  }

  return problems
}

/** The most terms a renewal is counted forward: a hundred years of the shortest. */
const mostTerms = 1200

/**
 * The last day of the term that runs on a day, or none for a contract
 * without an end. A contract with notice given ends on that day; one that
 * renews ends on the first end of a term on or after the day, each counted
 * from the end of the first term so that the 31st stays the 31st.
 */
export function termEnd(term: ContractTerm, on: IsoDate): IsoDate | null {
  if (term.cancelledTo !== null) {
    return term.cancelledTo
  }

  if (term.endsOn === null || term.renewalMonths === null || term.endsOn >= on) {
    return term.endsOn
  }

  for (let terms = 1; terms <= mostTerms; terms += 1) {
    const end = addMonths(term.endsOn, terms * term.renewalMonths)

    if (end >= on) {
      return end
    }
  }

  return addMonths(term.endsOn, mostTerms * term.renewalMonths)
}

/**
 * The last day notice may be given for the end of the term that runs on a
 * day, or none: without a notice period, without an end, once notice is
 * given, or once the contract has ended. It stays the day of this term after
 * it has passed, until the term is over and the next one counts.
 */
export function noticeBy(term: ContractTerm, on: IsoDate): IsoDate | null {
  if (term.cancelledTo !== null || term.noticeAmount === null || term.noticeUnit === null) {
    return null
  }

  const end = termEnd(term, on)

  if (end === null || end < on) {
    return null
  }

  return term.noticeUnit === 'weeks'
    ? addDays(end, -7 * term.noticeAmount)
    : addMonths(end, -term.noticeAmount)
}

/**
 * How a contract stands on a day: it has not begun yet, it runs, it renews
 * since the last day to give notice for this term has passed, notice is
 * given, or it has ended.
 */
export const contractStandings = ['upcoming', 'running', 'renews', 'cancelled', 'ended'] as const

export type ContractStanding = (typeof contractStandings)[number]

export const contractStandingLabel: Readonly<Record<ContractStanding, string>> = {
  upcoming: 'Beginnt später',
  running: 'Läuft',
  renews: 'Verlängert sich',
  cancelled: 'Gekündigt',
  ended: 'Abgelaufen',
}

export function contractStanding(term: ContractTerm, on: IsoDate): ContractStanding {
  const end = termEnd(term, on)

  if (end !== null && end < on) {
    return 'ended'
  }

  if (term.startsOn > on) {
    return 'upcoming'
  }

  if (term.cancelledTo !== null) {
    return 'cancelled'
  }

  const notice = noticeBy(term, on)

  return term.renewalMonths !== null && notice !== null && notice < on ? 'renews' : 'running'
}

/** "3 Monate", "6 Wochen": a notice period in words, or null without one. */
export function noticeWords(
  term: Pick<ContractTerm, 'noticeAmount' | 'noticeUnit'>,
): string | null {
  if (term.noticeAmount === null || term.noticeUnit === null) {
    return null
  }

  const unit =
    term.noticeAmount === 1
      ? term.noticeUnit === 'weeks'
        ? 'Woche'
        : 'Monat'
      : noticeUnitLabel[term.noticeUnit]

  return `${String(term.noticeAmount)} ${unit}`
}

/** A contract in the list of the office: its firm, what it covers in the areas of the reader, and how it stands today. */
export interface ContractEntry extends Contract {
  readonly contractorName: string
  readonly buildings: number
  readonly assets: number
  readonly runsUntil: IsoDate | null
  readonly noticeBy: IsoDate | null
  readonly standing: ContractStanding
}

/** What a contract covers: a building whole, or an asset. */
export const contractItemKinds = ['building', 'asset'] as const

export type ContractItemKind = (typeof contractItemKinds)[number]

/** A building or an asset a contract covers, as its page lists it, with where it stands. */
export interface ContractItem {
  readonly id: string
  readonly kind: ContractItemKind
  readonly buildingId: string | null
  readonly assetId: string | null
  /** "AN-00071 Personenaufzug Haus B" or the name of the building. */
  readonly name: string
  /** The property and the building, "Verwaltung Am Probehang, Haus B". */
  readonly where: string
}

/** A duty a contract fulfils, as its page lists it: as a row of the register, without the person who answers for it. */
export type ContractDuty = Pick<
  DutyEntry,
  | 'id'
  | 'title'
  | 'state'
  | 'appointment'
  | 'ended'
  | 'contractEnded'
  | 'propertyId'
  | 'buildingId'
  | 'roomId'
  | 'asset'
>

/** The page of a contract: the contract as its list says it, what it covers and the duties it fulfils. */
export interface ContractPage {
  readonly contract: ContractEntry
  readonly items: readonly ContractItem[]
  readonly duties: readonly ContractDuty[]
}

/** A contract as the record of an asset names it: one that covers the asset itself or its building. */
export interface AssetContract {
  readonly id: ContractId
  readonly title: string
  readonly contractorName: string
  /** Whether it covers the asset through its building. */
  readonly throughBuilding: boolean
  readonly runsUntil: IsoDate | null
  readonly standing: ContractStanding
}

/** The most items one contract covers, and the most contracts the record of an asset lists. */
export const contractBounds = { items: 500, atAnAsset: 50 } as const

/** Whether a value is a day of the calendar written in ISO 8601, for a route that takes one day alone. */
export function isCalendarDay(value: unknown): value is IsoDate {
  return calendarDay(value)
}

/**
 * An accepted work order with a warranty of its own, as the record of its
 * asset names it (#329): by its number and title, with the day the warranty ends.
 */
export interface OrderWarranty {
  /** The activity of the order, by which its page is addressed. */
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly warrantyEndsOn: IsoDate
}
