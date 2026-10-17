import type { IsoDate } from '@opengewerk/platform-domain'

import {
  type ActivityId,
  type ActivityKind,
  activityLimits,
  type ActivityPlan,
  activityPlanProblems,
  type ActivityStatus,
} from './activity.js'
import type { DutyState } from './duty.js'
import type { DutyId } from './duty-record.js'
import type { DutyPerson } from './duty-register.js'
import type { EvidenceId, EvidenceResult } from './evidence.js'
import type { StatedCollective } from './evidence.js'
import { calendarDay, type Problems, required } from './fields.js'
import { type Report, type ReportDefect, reportProblems } from './report.js'

/**
 * A collective activity (section 4.4 of the concept, #342): "alle Feuerlöscher
 * eines Gebäudes, alle ortsveränderlichen Betriebsmittel eines Bereichs".
 * Whoever plans and hands out work composes it in the office from a duty kind
 * and a place, and what falls due in the chosen time is chosen already. It
 * holds a part for each duty: an inspection or a maintenance at the place of
 * that duty, with its own protocol, its day and its result. On site the
 * assets are inspected one after the other and signed once, under a page
 * that names every asset with its result; every duty gets its own evidence.
 *
 * An open activity of a chosen duty goes up in it and becomes a part; one
 * somebody began stays on its own. A collective activity stands on one
 * property, as every activity does, at the property, a building or a room,
 * and holds only duties in the area of that place.
 */

/** How many parts a collective activity holds at most: one page is signed for all of them. */
export const collectiveLimits = { parts: 500 } as const

/** A duty kind with duties at a place, as the office offers it to choose. */
export interface CollectiveKind {
  readonly key: string
  readonly label: string
  /** How many duties of the kind run at the place, in its area. */
  readonly duties: number
}

/**
 * A duty of the kind at the place, as the office offers it: the duty with
 * its asset and where that is, the day it is due on today, how it stands, and
 * the activity under way for it, if one is.
 */
export interface CollectiveCandidate {
  readonly dutyId: DutyId
  readonly title: string
  readonly asset: {
    readonly id: string
    readonly number: string | null
    readonly name: string
  } | null
  /** Where in the place it is, in words: building, floor, room. */
  readonly where: string
  readonly appointment: IsoDate | null
  readonly state: DutyState
  readonly activity: {
    readonly id: ActivityId
    readonly kind: ActivityKind
    readonly status: ActivityStatus
    /** Whether it is a part of a collective activity already. */
    readonly partOfOne: boolean
    /** Who performs it, by name, where somebody is named. */
    readonly performer: string | null
  } | null
}

/** What the office is answered while it composes: the kinds at the place, and the duties of the one chosen. */
export interface CollectiveCandidates {
  readonly kinds: readonly CollectiveKind[]
  readonly candidates: readonly CollectiveCandidate[]
  /**
   * The duties of the kind at the place that lie in another area, a building
   * with an area of its own: they are not offered, and the office says how
   * many there are.
   */
  readonly elsewhere: number
  /**
   * Who may be named in its plan: who answers for it among those who plan
   * and hand out work, and who performs it, each seeing the area of the
   * place. The name and nothing else of a person.
   */
  readonly people: {
    readonly responsible: readonly DutyPerson[]
    readonly performers: readonly DutyPerson[]
  }
}

/**
 * Whether a duty may become a part: it has no activity under way, or an open
 * inspection or maintenance that is no part of a collective activity yet.
 * One somebody began, one signed, a work order for its due day and a part of
 * another collective activity stay as they are.
 */
export function mayBecomeAPart(candidate: Pick<CollectiveCandidate, 'activity'>): boolean {
  return (
    candidate.activity === null ||
    (candidate.activity.status === 'open' &&
      candidate.activity.kind !== 'work_order' &&
      !candidate.activity.partOfOne)
  )
}

/**
 * Whether a duty falls due in the days asked about, and so is chosen at
 * first: due on a day between the two, or due already and still not met on
 * the day it is asked, or never recorded, which is due at once.
 */
export function dueWithin(
  appointment: IsoDate | null,
  days: { readonly from: IsoDate; readonly to: IsoDate },
  today: IsoDate,
): boolean {
  if (appointment === null) {
    return true
  }

  return appointment <= days.to && (appointment >= days.from || appointment < today)
}

/** The title a collective activity is offered with: what the duty kind is called, and where. */
export function collectiveTitle(kindLabel: string, placeName: string): string {
  return `${kindLabel}, ${placeName}`.slice(0, activityLimits.title).trim()
}

/**
 * What the office sends to compose one: the duty kind and the place, its
 * title, the duties it takes, and its plan, which every part takes over.
 */
export interface CollectivePlan extends ActivityPlan {
  readonly dutyKind: string
  readonly propertyId: string
  readonly buildingId: string | null
  readonly roomId: string | null
  readonly title: string
  readonly dutyIds: readonly string[]
}

/**
 * What is wrong with a plan, one sentence per field: what any plan of an
 * activity needs, a title, the duty kind and the property, at most one of a
 * building and a room, and between one and the most duties, each once.
 * Whether the duties are of the kind, at the place and free to take, the
 * server asks.
 */
export function collectivePlanProblems(
  plan: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = { ...activityPlanProblems(plan) }

  required(problems, { title: plan['title'] ?? null }, 'title', activityLimits.title, 'Der Titel')

  if (typeof plan['dutyKind'] !== 'string' || plan['dutyKind'] === '') {
    problems['dutyKind'] = 'Ein Sammelvorgang hat eine Pflichtart.'
  }

  if (typeof plan['propertyId'] !== 'string' || plan['propertyId'] === '') {
    problems['propertyId'] = 'Ein Sammelvorgang steht auf einer Liegenschaft.'
  }

  const named = (field: string) => typeof plan[field] === 'string' && plan[field] !== ''

  if (named('buildingId') && named('roomId')) {
    problems['roomId'] =
      'Ein Sammelvorgang steht an einem Gebäude oder einem Raum, nicht an beidem.'
  }

  const dutyIds = plan['dutyIds']

  if (
    !Array.isArray(dutyIds) ||
    dutyIds.length === 0 ||
    dutyIds.some((id) => typeof id !== 'string')
  ) {
    problems['dutyIds'] = 'Ein Sammelvorgang nimmt mindestens eine Pflicht.'
  } else if (dutyIds.length > collectiveLimits.parts) {
    problems['dutyIds'] =
      `Ein Sammelvorgang nimmt höchstens ${String(collectiveLimits.parts)} Pflichten.`
  } else if (new Set(dutyIds).size !== dutyIds.length) {
    problems['dutyIds'] = 'Jede Pflicht steht einmal im Sammelvorgang.'
  }

  if (!calendarDay(plan['dueOn'])) {
    problems['dueOn'] = 'Die Fälligkeit ist ein Tag, geschrieben 2026-10-03.'
  }

  return problems
}

/**
 * A part of a collective activity as its page in the office shows it: the
 * activity at the asset, the duty it meets with the day it is due on, and
 * what came of it, with the evidence once it is written down.
 */
export interface CollectivePart {
  readonly id: ActivityId
  readonly status: ActivityStatus
  readonly asset: {
    readonly id: string
    readonly number: string | null
    readonly name: string
  } | null
  readonly where: string
  readonly dutyId: DutyId
  readonly dutyTitle: string
  readonly appointment: IsoDate | null
  readonly performedOn: IsoDate | null
  readonly result: EvidenceResult | null
  readonly resultReason: string | null
  readonly evidence: { readonly id: EvidenceId; readonly number: string } | null
}

/** A result as a part of a collective activity holds it on each of its duties. */
interface PartResult {
  readonly result: EvidenceResult | null
  readonly resultReason: string | null
}

/**
 * Whether a part has its result: every duty of it has one, and "not
 * performed" with its reason. Until every part has, nobody signs.
 */
export function partHasItsResult(duties: readonly PartResult[]): boolean {
  return (
    duties.length > 0 &&
    duties.every(
      (line) =>
        line.result !== null &&
        (line.result !== 'not_performed' ||
          (line.resultReason !== null && line.resultReason.trim() !== '')),
    )
  )
}

/**
 * Whether the protocol of a part asks for its answers (section 4.4: "Eine
 * Anlage, die nicht erreichbar ist, nimmt nicht durchgeführt mit Grund"): an
 * asset that was not performed at all was not inspected, and its protocol
 * stays as far as it came. Every other part answers every point.
 */
export function partAsksForAnswers(duties: readonly PartResult[]): boolean {
  return !duties.every((line) => line.result === 'not_performed')
}

/**
 * A part of the report of a contractor for a collective activity (#342): the
 * result of its asset, with the reason of "not performed", and the defects
 * the report names at that asset.
 */
export interface CollectiveReportPart {
  readonly activityId: string
  readonly result: EvidenceResult
  readonly resultReason: string | null
  readonly defects: readonly ReportDefect[]
}

/**
 * The report of a contractor for many assets, entered at its collective
 * activity in one go (section 4.4: "Ein Bericht kann viele Anlagen abdecken
 * und wird in einem Zug zugeordnet"): the file once, the examiner, the
 * organisation and the day, and a result for each part. It becomes one
 * evidence per duty, each with the file.
 */
export interface CollectiveReport extends Omit<Report, 'result' | 'resultReason' | 'defects'> {
  readonly parts: readonly CollectiveReportPart[]
}

/** Where the problem of a field of a part stands among the problems of the report. */
export function collectiveReportField(index: number, field: string): string {
  return `parts.${String(index)}.${field}`
}

/** The fields of a report that the whole of it says once, and not each part. */
const sharedReportFields = new Set(['file', 'performedOn', 'examiner', 'examinerOrganisation'])

/**
 * What is wrong with the report for a collective activity on this day: what
 * the report of one duty would have wrong (`reportProblems`), the file, the
 * day, the examiner and the organisation once, and the result, its reason
 * and the defects of each part at that part. It names each part once.
 */
export function collectiveReportProblems(
  report: Readonly<Record<string, unknown>>,
  today: IsoDate,
  offersClass: (key: string) => boolean,
): Readonly<Problems> {
  const problems: Problems = {}
  const parts = report['parts']

  if (!Array.isArray(parts) || parts.length === 0) {
    return {
      ...Object.fromEntries(
        Object.entries(
          reportProblems({ ...report, result: 'without_defects' }, today, offersClass),
        ).filter(([field]) => sharedReportFields.has(field)),
      ),
      parts: 'Der Bericht nennt ein Ergebnis für jede Anlage.',
    }
  }

  if (parts.length > collectiveLimits.parts) {
    problems['parts'] = `Ein Bericht nennt höchstens ${String(collectiveLimits.parts)} Anlagen.`
  }

  const named = parts.map((part: unknown) =>
    typeof part === 'object' && part !== null
      ? (part as Record<string, unknown>)['activityId']
      : null,
  )

  if (named.some((id) => typeof id !== 'string') || new Set(named).size !== named.length) {
    problems['parts'] ??= 'Der Bericht nennt jede Anlage einmal.'
  }

  parts.forEach((part: unknown, index) => {
    const given = typeof part === 'object' && part !== null ? (part as Record<string, unknown>) : {}
    const single = reportProblems(
      {
        ...report,
        result: given['result'],
        resultReason: given['resultReason'] ?? null,
        defects: given['defects'] ?? [],
      },
      today,
      offersClass,
    )

    for (const [field, sentence] of Object.entries(single)) {
      if (sharedReportFields.has(field)) {
        problems[field] ??= sentence
      } else {
        problems[collectiveReportField(index, field)] = sentence
      }
    }
  })

  return problems
}

/**
 * What an evidence written with a collective activity says of it (#342), on
 * its page and in its PDF: which one, how many assets it held, and that its
 * one signature stands under the page of all of them.
 */
export function collectiveStatement(collective: StatedCollective): string {
  const parts = collective.parts === 1 ? '1 Anlage' : `${String(collective.parts)} Anlagen`

  return `${collective.title}, ${parts}. Die Unterschrift steht unter der Seite aller Anlagen.`
}
