import { checkPointResultLabel, type IsoDate } from '@opengewerk/platform-domain'

import { type LifecycleState, lifecycleStateLabel } from './asset.js'
import type { AssetBook } from './catalogue.js'
import { type EvidenceStanding, evidenceStandingLabel } from './duty-register.js'
import {
  type EvidenceId,
  type EvidenceResult,
  evidenceResultLabel,
  type EvidenceState,
  type StatedAnswer,
  type StatedDefect,
  type StatedPerformer,
  statedPointWords,
} from './evidence.js'
import { evidenceRegisterWords } from './evidence-register.js'
import { dayInWords, type TableRow } from './office-table.js'

/**
 * The book of an asset (#437, section 8 of the concept): all its evidence in
 * the order of time with the entries of its life cycle, as a PDF and as a
 * table, on the day it is made. A kind of asset of a package may give it a
 * name of its own with the regulation that asks for it, the evaporative
 * cooling system its "Betriebstagebuch" by § 12 of the 42. BImSchV (decided
 * by Moritz on 18.10.2026); otherwise it is the "Anlagenbuch".
 *
 * The book is no record of its own: it is made from the frozen states each
 * time it is asked for, and it lasts as long as its evidence is kept.
 */
export const assetBookWords = {
  title: 'Anlagenbuch',
  lifecycle: 'Lebenszyklus',
  evidence: 'Nachweis',
  emptied: 'Nach Ablauf der Aufbewahrung geleert',
  /** Who did the work where it was a person of the operator: the book names none (#437). */
  ownStaff: 'Eigenes Personal',
  /** What the server answers where the evidence behind the book would weigh too much. */
  tooLarge:
    'Mit den Nachweisen dahinter würde das Anlagenbuch größer als 200 MB. Geben Sie es ohne die Nachweise aus.',
} as const

/** The name of the book of an asset of a kind, and the regulation that asks for it, where its package names one. */
export function assetBookTitle(book: AssetBook | undefined): {
  readonly title: string
  readonly source: string | null
} {
  return book === undefined
    ? { title: assetBookWords.title, source: null }
    : { title: book.title, source: book.source }
}

/** An entry of the life cycle of the asset: the state and the day it holds from. */
export interface AssetBookLifecycle {
  readonly state: LifecycleState
  readonly validFrom: IsoDate
}

/** An evidence of the asset as the book reads it. */
export interface AssetBookEvidence {
  readonly id: EvidenceId
  readonly number: string
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  /** The title of its duty, which an emptied evidence no longer states itself. */
  readonly duty: string
  readonly standing: EvidenceStanding
  /** Why it was declared invalid, where it was. */
  readonly voidedFor: string | null
  /** Its frozen state; none once it was emptied after its retention (#340). */
  readonly state: EvidenceState | null
}

/** A line of the book, as the PDF and the table write it. */
export interface AssetBookLine {
  readonly on: IsoDate
  readonly kind: 'lifecycle' | 'evidence'
  /** The state of the life cycle, or the duty the evidence met. */
  readonly entry: string
  readonly number: string | null
  readonly source: string | null
  /** The reason it was not performed, the answers, the correction and the remark, in one text. */
  readonly said: string | null
  readonly defects: string | null
  readonly result: string | null
  /** Who did the work: an examiner from outside with the organisation, never a person of the operator. */
  readonly performer: string | null
  /** Replaced, declared invalid with the reason, from the old stock, or emptied. */
  readonly mark: string | null
  readonly evidenceId: EvidenceId | null
}

/**
 * One answer in words: its point, what was said, the limit with whether the
 * value kept it, and the remark. "Legionella spp.: 1.300 KBE/100 ml,
 * höchstens 100 KBE/100 ml: nicht eingehalten".
 */
export function bookAnswerWords(answer: StatedAnswer): string {
  const said =
    answer.result !== null
      ? checkPointResultLabel[answer.result]
      : (answer.value ?? (answer.photo === null ? 'keine Angabe' : 'Foto'))
  const limit =
    answer.limit === null
      ? null
      : answer.limit.within === null
        ? answer.limit.text
        : `${answer.limit.text}: ${answer.limit.within ? 'eingehalten' : 'nicht eingehalten'}`

  return [`${statedPointWords(answer)}: ${said}`, limit, answer.remark]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ')
}

/**
 * Who did the work, as the book says it: an examiner from outside with the
 * organisation, a person of the operator never. Like the register of
 * evidence and every table but the Leitung's, the book names no employee;
 * the PDF of each evidence behind it does (Verfahrensbeschreibung, 4).
 */
function performerWords(performer: StatedPerformer | null): string | null {
  if (performer === null) {
    return null
  }

  return 'person' in performer
    ? assetBookWords.ownStaff
    : `${performer.examiner}, ${performer.organisation}`
}

function defectWords(defect: StatedDefect, classLabel: (key: string) => string | null): string {
  return [
    `Mangel: ${defect.description}`,
    defect.defectClass === null ? null : (classLabel(defect.defectClass) ?? defect.defectClass),
    defect.dueOn === null ? null : `Frist ${dayInWords(defect.dueOn)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}

function saidOf(state: EvidenceState): string | null {
  const parts = [
    state.resultReason,
    ...state.answers.map(bookAnswerWords),
    state.replaces === null
      ? null
      : `Berichtigt ${state.replaces.number}: ${state.replaces.reason}`,
    state.remark,
  ].filter((part): part is string => part !== null && part !== '')

  return parts.length === 0 ? null : parts.join('; ')
}

function lifecycleLine(entry: AssetBookLifecycle): AssetBookLine {
  return {
    on: entry.validFrom,
    kind: 'lifecycle',
    entry: lifecycleStateLabel[entry.state],
    number: null,
    source: null,
    said: null,
    defects: null,
    result: null,
    performer: null,
    mark: null,
    evidenceId: null,
  }
}

function evidenceLine(
  entry: AssetBookEvidence,
  classLabel: (key: string) => string | null,
): AssetBookLine {
  const { state } = entry
  // An evidence declared invalid or replaced stays in the book and says so
  // (ADR 0004, points 14 and 15), one from the old stock as well (section 11).
  const marks = [
    entry.standing === 'voided'
      ? [evidenceStandingLabel.voided, entry.voidedFor].filter(Boolean).join(': ')
      : entry.standing === 'replaced'
        ? evidenceStandingLabel.replaced
        : null,
    state?.origin === 'legacy' ? evidenceRegisterWords.legacy : null,
    state === null ? assetBookWords.emptied : null,
  ].filter((mark): mark is string => mark !== null)
  const defects = state?.defects.map((defect) => defectWords(defect, classLabel)) ?? []

  return {
    on: entry.performedOn,
    kind: 'evidence',
    entry: state?.duty.label ?? entry.duty,
    number: entry.number,
    source: state?.duty.source ?? null,
    said: state === null ? null : saidOf(state),
    defects: defects.length === 0 ? null : defects.join('; '),
    result: evidenceResultLabel[entry.result],
    performer: state === null ? null : performerWords(state.performer),
    mark: marks.length === 0 ? null : marks.join('; '),
    evidenceId: entry.id,
  }
}

/**
 * The lines of the book in the order of time. On one day the life cycle
 * comes first, so that an asset is in service before it is checked, and the
 * evidence follows by its number.
 */
export function assetBookLines(
  lifecycle: readonly AssetBookLifecycle[],
  evidence: readonly AssetBookEvidence[],
  classLabel: (key: string) => string | null,
): readonly AssetBookLine[] {
  return [
    ...lifecycle.map(lifecycleLine),
    ...evidence.map((entry) => evidenceLine(entry, classLabel)),
  ].sort(
    (one, other) =>
      one.on.localeCompare(other.on) ||
      Number(one.kind === 'evidence') - Number(other.kind === 'evidence') ||
      (one.number ?? '').localeCompare(other.number ?? ''),
  )
}

/**
 * The head of the book: its name and regulation, the day and the operator,
 * and what the file knows of the asset, as Anlage 4 Teil 1 of the
 * 42. BImSchV asks for it as far as the application holds it.
 */
export interface AssetBookHead {
  readonly title: string
  readonly source: string | null
  readonly today: IsoDate
  readonly operator: string
  readonly asset: string
  readonly kind: string
  /** Property, building and room, and the address; none for whoever does not read places (#237). */
  readonly place: string | null
  readonly address: string | null
  readonly commissionedOn: IsoDate | null
  /** The fields of its kind the asset holds, each with its label: the ID of an evaporative cooling system among them. */
  readonly fields: readonly { readonly label: string; readonly value: string }[]
}

/** The facts of the head, in the order the PDF shows them. */
export function assetBookFacts(
  head: AssetBookHead,
): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: 'Anlage', value: head.asset },
    { label: 'Anlagenart', value: head.kind },
    ...head.fields,
    ...(head.place === null
      ? []
      : [
          {
            label: 'Standort',
            value: head.address === null ? head.place : `${head.place}\n${head.address}`,
          },
        ]),
    { label: 'Betreiber', value: head.operator },
    {
      label: 'Erste Inbetriebnahme',
      value: head.commissionedOn === null ? 'nicht erfasst' : dayInWords(head.commissionedOn),
    },
  ]
}

/** What the book holds, in words, as its PDF and the dialog before it say it. */
export function assetBookCountWords(
  evidenceDays: readonly IsoDate[],
  lifecycleDays: readonly IsoDate[],
): string {
  const days = [...evidenceDays, ...lifecycleDays].sort()
  const first = days[0]
  const last = days[days.length - 1]

  if (first === undefined || last === undefined) {
    return 'Noch kein Eintrag: die Anlage hat keinen Nachweis und keinen Eintrag im Lebenszyklus.'
  }

  const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`
  const when =
    first === last ? `am ${dayInWords(first)}` : `vom ${dayInWords(first)} bis ${dayInWords(last)}`

  return `${count(days.length, 'Eintrag', 'Einträge')} ${when}: ${count(evidenceDays.length, 'Nachweis', 'Nachweise')} und ${count(lifecycleDays.length, 'Eintrag', 'Einträge')} des Lebenszyklus.`
}

/** The columns of the book as a table, a row per entry. */
export const assetBookColumns = [
  'Tag',
  'Art',
  'Eintrag',
  'Fundstelle',
  'Nummer',
  'Angaben',
  'Mängel',
  'Ergebnis',
  'Durchgeführt von',
  'Kennzeichnung',
] as const

/** The book as the rows of a table, in the order of its lines. */
export function assetBookRows(lines: readonly AssetBookLine[]): readonly TableRow[] {
  return lines.map((line): TableRow => [
    { day: line.on },
    line.kind === 'lifecycle' ? assetBookWords.lifecycle : assetBookWords.evidence,
    line.entry,
    line.source,
    line.number,
    line.said,
    line.defects,
    line.result,
    line.performer,
    line.mark,
  ])
}
