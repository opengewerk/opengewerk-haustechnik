import { addDays, type IsoDate } from '@opengewerk/platform-domain'

import type { ActivityKind, ActivityStatus } from './activity.js'
import type { Asset } from './asset.js'
import type { DutyReading, LastEvidence } from './asset-condition.js'
import type { Appointment, DutyState } from './duty.js'
import type { Duty, DutyPerformer } from './duty-record.js'
import {
  type Evidence,
  type EvidenceOrigin,
  type EvidenceResult,
  meetsTheDuty,
} from './evidence.js'

/**
 * The register of duties (section 4.3 of the concept): every duty of an
 * operator with what it hangs on, its source, its interval, who answers for
 * it, who performs it, its last evidence and its next appointment. What the
 * server answers and the office reads, and the rules both hold to.
 *
 * The state of a duty is derived on the day it is read (ADR 0002, point 16).
 * The register adds one thing the five states do not say: a duty that has
 * ended calls for nothing any more, and stands in a list of its own.
 */

/**
 * The states of a duty in the order of the register: never recorded before
 * overdue, because nobody knows since when it has been due (section 2.3),
 * then what is coming, what is met, and last what rests.
 */
export const dutyRegisterOrder = [
  'never_recorded',
  'overdue',
  'due',
  'met',
  'dormant',
] as const satisfies readonly DutyState[]

/** What the register calls the duties that have ended, beside the five states. */
export const endedDuties = 'ended'

/** What the register is narrowed to under "Zustand": a state, or the duties that have ended. */
export const dutyRegisterStates = [...dutyRegisterOrder, endedDuties] as const

export type DutyRegisterState = (typeof dutyRegisterStates)[number]

/** The words of the register for each list. "Erfüllt" stands without a day: the list holds many. */
export const dutyRegisterStateLabel: Readonly<Record<DutyRegisterState, string>> = {
  never_recorded: 'Nie erfasst',
  overdue: 'Überfällig',
  due: 'Fällig',
  met: 'Erfüllt',
  dormant: 'Ruht',
  ended: 'Beendet',
}

/**
 * Whether a duty has ended on a day: from the day it ends it calls for
 * nothing, so that day itself is past its end.
 */
export function dutyHasEnded(duty: Pick<Duty, 'endsOn'>, on: IsoDate): boolean {
  return duty.endsOn !== null && duty.endsOn <= on
}

/** The value of the filter for the duties nobody answers for. */
export const withoutResponsible = 'none'

/**
 * What the register is narrowed to under "Fällig" (#122): the duties whose
 * appointment falls in the next 30 or 90 days, and the overdue ones together
 * with those of the next 30 days, which is the table of the overview.
 *
 * The windows are counted by the day of the appointment and not by the
 * state: a duty due in 20 days whose lead time has not begun is met until
 * then, and still falls due within 30 days. The overdue ones are counted in
 * neither of the first two (decision 40 of phase 1, 10.10.2026), and the
 * window of 90 days holds the one of 30.
 */
export const dutyDueWindows = ['in_30_days', 'in_90_days', 'overdue_or_in_30_days'] as const

export type DutyDueWindow = (typeof dutyDueWindows)[number]

export const dutyDueWindowLabel: Readonly<Record<DutyDueWindow, string>> = {
  in_30_days: 'In 30 Tagen',
  in_90_days: 'In 90 Tagen',
  overdue_or_in_30_days: 'Überfällig oder in 30 Tagen',
}

/** How many days ahead each window reaches, and whether it holds the overdue duties. */
const dueWindowReach: Readonly<Record<DutyDueWindow, { days: number; overdue: boolean }>> = {
  in_30_days: { days: 30, overdue: false },
  in_90_days: { days: 90, overdue: false },
  overdue_or_in_30_days: { days: 30, overdue: true },
}

/**
 * Whether a duty falls in a window on a day: it has not ended and does not
 * rest, it has an appointment, the day of that is no further ahead than the
 * window reaches, and it is overdue only where the window holds those. A duty
 * never recorded has no appointment, so it falls in none.
 */
export function inDueWindow(
  entry: Pick<DutyEntry, 'state' | 'appointment' | 'ended'>,
  window: DutyDueWindow,
  today: IsoDate,
): boolean {
  const { days, overdue } = dueWindowReach[window]

  if (entry.ended || entry.appointment === null) {
    return false
  }

  if (entry.state === 'overdue') {
    return overdue
  }

  // ISO dates sort the same way as the days they name.
  return (
    (entry.state === 'due' || entry.state === 'met') &&
    entry.appointment.dueOn <= addDays(today, days)
  )
}

/**
 * What the register of duties is asked for. Every part narrows, and two
 * together give what passes both.
 */
export interface DutyRegisterFilter {
  readonly state?: DutyRegisterState
  /** The duties whose appointment falls in a window of days from today (#122). */
  readonly due?: DutyDueWindow
  readonly propertyId?: string
  /** An area of the person asking: the duties at the places in it (#122). */
  readonly areaId?: string
  /** A building: the duties at it, at its rooms and at the assets that stand in it. */
  readonly buildingId?: string
  /** The key of an asset kind, `<package>.<key>`: the duties at assets of the kind. */
  readonly assetKind?: string
  /** The key of a duty kind of the catalogue, `<package>.<key>`. */
  readonly dutyKind?: string
  /** The person who answers for a duty, or `none` for the duties nobody answers for. */
  readonly responsible?: string
}

/** The names of the filters as an address carries them to the server, in the order it reads them. */
export const dutyRegisterFilters = [
  'state',
  'due',
  'propertyId',
  'areaId',
  'buildingId',
  'assetKind',
  'dutyKind',
  'responsible',
] as const satisfies readonly (keyof DutyRegisterFilter)[]

/** How many duties a page of the register holds, and the most a page may be asked for. */
export const dutyRegisterPage = { size: 50, most: 200 } as const

/**
 * Whether a filter names one person. The register then is a list about that
 * person: only whoever keeps the register may ask for it, and it is answered
 * without a single number, so that no count of what somebody is behind with
 * comes about (sections 4.16 and 9 of the concept: no evaluation by person).
 */
export function namesAPerson(filter: Pick<DutyRegisterFilter, 'responsible'>): boolean {
  return filter.responsible !== undefined && filter.responsible !== withoutResponsible
}

/** Somebody a duty names, by the name of the account. */
export interface DutyPerson {
  readonly userId: string
  readonly name: string
}

/**
 * Somebody who works for the operator, as whoever keeps the register is
 * handed them to say who answers for a duty: the name, and whether they can
 * still be named. Nothing else of a person, neither role nor address.
 */
export interface DutyColleague extends DutyPerson {
  /** False for somebody shut out of this operator: still named where a duty names them, not offered anew. */
  readonly active: boolean
}

/** The asset a duty hangs on, as a row and the page of a duty name it. */
export type DutyAsset = Pick<Asset, 'id' | 'number' | 'name' | 'kind' | 'buildingId' | 'roomId'>

/**
 * A duty as the register lists it: what it is and how it stands today, what
 * it hangs on, who answers for it and who performs it, and the evidence its
 * appointment is counted from.
 */
export interface DutyEntry
  extends
    DutyReading,
    Pick<
      Duty,
      | 'propertyId'
      | 'buildingId'
      | 'roomId'
      | 'assetId'
      | 'intervalReason'
      | 'responsibleUserId'
      | 'performer'
      | 'performerNote'
    > {
  /** Whether it has ended today. Its state then says how it stood when it did, and calls for nothing. */
  readonly ended: boolean
  readonly asset: DutyAsset | null
  readonly responsible: DutyPerson | null
  readonly lastEvidence: LastEvidence | null
}

/**
 * A page of the register, with how much there is behind it.
 *
 * The numbers are null where the register is narrowed to one person
 * (`namesAPerson`); `more` says in every case whether a further page follows.
 */
export interface DutyRegister {
  /** How many duties pass the filters, in the areas of the person asking. */
  readonly total: number | null
  /** On how many assets they hang, and on how many places that are no asset. */
  readonly assets: number | null
  readonly places: number | null
  /** How many there are of each state and how many have ended, whatever state the page is narrowed to. */
  readonly counts: Readonly<Record<DutyRegisterState, number>> | null
  /** How many of the duties that have not ended name nobody who answers for them, whatever person or state the page is narrowed to. */
  readonly withoutResponsible: number
  readonly more: boolean
  readonly duties: readonly DutyEntry[]
  /**
   * The people the duties of the person asking name, for the choice of the
   * filter. Only for whoever may narrow by a person, and null for anybody else.
   */
  readonly people: readonly DutyPerson[] | null
}

/**
 * The order of the register: by state, then by the day a duty falls due, the
 * earliest first and a duty without a day last, then by the number of its
 * asset, by what it is called and by its id, so that two pages never show a
 * duty twice.
 */
export function inRegisterOrder(
  left: Pick<DutyEntry, 'id' | 'state' | 'appointment' | 'asset' | 'title'>,
  right: Pick<DutyEntry, 'id' | 'state' | 'appointment' | 'asset' | 'title'>,
): number {
  const rank = (entry: { readonly state: DutyState }) => dutyRegisterOrder.indexOf(entry.state)
  // ISO dates sort the same way as the days they name; no day sorts last.
  const day = (entry: { readonly appointment: Appointment | null }) =>
    entry.appointment?.dueOn ?? '9999-12-31'
  const number = (entry: { readonly asset: DutyAsset | null }) => entry.asset?.number ?? ''

  return (
    rank(left) - rank(right) ||
    day(left).localeCompare(day(right)) ||
    number(left).localeCompare(number(right)) ||
    left.title.localeCompare(right.title, 'de') ||
    left.id.localeCompare(right.id)
  )
}

/**
 * A duty as its page reads it: the record whole, how it stands today, what it
 * hangs on and who answers for it.
 */
export interface DutyDetails extends Duty {
  readonly title: string
  readonly state: DutyState
  readonly appointment: Appointment | null
  readonly lastMetOn: IsoDate | null
  readonly ended: boolean
  readonly asset: DutyAsset | null
  readonly responsible: DutyPerson | null
  /**
   * The inspection or maintenance under way for the duty (#183), as far as
   * the person asking is shown it, or null: none is, or it is not theirs to
   * see.
   */
  readonly activity: DutyActivity | null
}

/**
 * The activity under way for a duty, as the page of the duty names it and
 * the form of a report reads it (#183, #186): what it is and where it
 * stands, and who performs it.
 */
export interface DutyActivity {
  readonly id: string
  readonly kind: ActivityKind
  readonly status: ActivityStatus
  readonly dueOn: IsoDate | null
  readonly performer: DutyPerformer | null
  readonly contractorNote: string | null
}

/**
 * What an evidence means for the appointment of its duty (ADR 0004, points
 * 14 and 15): it counts, it stands but did not meet the duty, a correction
 * replaced it, or it was declared invalid.
 */
export const evidenceStandings = ['counts', 'does_not_meet', 'replaced', 'voided'] as const

export type EvidenceStanding = (typeof evidenceStandings)[number]

export const evidenceStandingLabel: Readonly<Record<EvidenceStanding, string>> = {
  counts: 'Zählt',
  does_not_meet: 'Zählt nicht',
  replaced: 'Ersetzt',
  voided: 'Für ungültig erklärt',
}

/**
 * What each evidence of a duty means for its appointment. An evidence
 * declared invalid says so, whether or not a correction replaced it as well:
 * that is the stronger of the two statements about it.
 */
export function evidenceStandingOf<
  Row extends {
    readonly id: string
    readonly replacesEvidenceId: string | null
    readonly result: EvidenceResult
  },
>(rows: readonly Row[], voided: ReadonlySet<string>): (row: Row) => EvidenceStanding {
  const replaced = new Set(
    rows.flatMap((row) => (row.replacesEvidenceId === null ? [] : [row.replacesEvidenceId])),
  )

  return (row) => {
    if (voided.has(row.id)) {
      return 'voided'
    }

    if (replaced.has(row.id)) {
      return 'replaced'
    }

    return meetsTheDuty(row.result) ? 'counts' : 'does_not_meet'
  }
}

/** An evidence of a duty as its page lists it: no person, the page of an evidence names them. */
export interface DutyEvidenceEntry extends Pick<
  Evidence,
  'id' | 'number' | 'performedOn' | 'result'
> {
  readonly origin: EvidenceOrigin
  readonly standing: EvidenceStanding
}
