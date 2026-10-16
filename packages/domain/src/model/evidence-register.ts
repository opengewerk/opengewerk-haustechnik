import type { IsoDate } from '@opengewerk/platform-domain'

import { dutyInterval, intervalWords } from './duty-record.js'
import type { DutyEntry } from './duty-register.js'
import { type EvidenceId, type EvidenceResult, evidenceResultLabel } from './evidence.js'
import { byNameIn } from './name-order.js'
import { dayInWords, type TableRow } from './office-table.js'

/**
 * The register of evidence (#338, section 4.3 of the concept): every duty of
 * the assets chosen with its last evidence, for an inspection or an audit,
 * on the day it is made. A block per asset, a line per duty.
 *
 * Evidence from the old stock never looks like evidence somebody signed here
 * (section 11): its line carries the mark "Altbestand, ohne Unterschrift". A
 * duty without any evidence says "Nie erfasst".
 */
export const evidenceRegisterWords = {
  title: 'Nachweisverzeichnis',
  legacy: 'Altbestand, ohne Unterschrift',
  never: 'Nie erfasst',
} as const

/** What a line of the register reads of a duty: its row in the duty register, as far as the line needs it. */
export type EvidenceRegisterDuty = Pick<
  DutyEntry,
  | 'id'
  | 'title'
  | 'intervalDays'
  | 'intervalMonths'
  | 'shortened'
  | 'intervalReason'
  | 'lastEvidence'
  | 'appointment'
  | 'asset'
  | 'assetId'
  | 'propertyId'
  | 'buildingId'
  | 'roomId'
>

/** The document that bears the interval of a duty, with its version and its day (#74). */
export interface IntervalDocument {
  readonly title: string
  readonly version: number
  readonly datedOn: IsoDate | null
}

/** A duty with what only the register of evidence asks of it. */
export interface EvidenceRegisterEntry {
  readonly duty: EvidenceRegisterDuty
  /**
   * Where the duty comes from, as the register of duties says it: the source
   * its kind names in the catalogue, or for one of the operator's own its
   * basis and the source it names. The catalogue is the server's, so the
   * server puts it in.
   */
  readonly source: string
  /** The result of its last evidence, which the row of the duty register does not carry. */
  readonly lastResult: EvidenceResult | null
  readonly intervalDocument: IntervalDocument | null
}

/** A line of the register: a duty, in words. */
export interface EvidenceRegisterLine {
  readonly dutyId: string
  readonly duty: string
  readonly reference: string
  /** "Bescheid des Gesundheitsamts, Fassung 2 vom 03.02.2026", or null. */
  readonly document: string | null
  readonly interval: string
  readonly reason: string | null
  /** "14.03.2026, Ohne Mangel", or null where there is no evidence. */
  readonly last: string | null
  /** The day and the result of the last evidence, each on its own, for a column of a table. */
  readonly performedOn: IsoDate | null
  readonly result: string | null
  readonly evidenceId: EvidenceId | null
  readonly evidenceNumber: string | null
  /** The mark of a line whose last evidence was signed nowhere here, or that has none. */
  readonly mark: (typeof evidenceRegisterWords)['legacy' | 'never'] | null
  readonly nextDue: IsoDate | null
}

/** A block of the register: the duties of one asset, or of one place that is no asset. */
export interface EvidenceRegisterBlock {
  readonly asset: EvidenceRegisterDuty['asset']
  /** The room, the building or the property the duties hang on where they hang on no asset. */
  readonly placeId: string | null
  /** Where the block stands, as the lists name a place (`targetWhere`). */
  readonly target: Pick<EvidenceRegisterDuty, 'propertyId' | 'buildingId' | 'roomId' | 'assetId'>
  readonly lines: readonly EvidenceRegisterLine[]
}

/** The document of a line in words. */
function documentWords(document: IntervalDocument): string {
  const day = document.datedOn === null ? '' : ` vom ${dayInWords(document.datedOn)}`

  return `${document.title}, Fassung ${String(document.version)}${day}`
}

/** A duty as a line of the register. */
export function evidenceRegisterLine(entry: EvidenceRegisterEntry): EvidenceRegisterLine {
  const { duty, source, lastResult, intervalDocument } = entry
  const evidence = duty.lastEvidence
  const performed =
    evidence === null
      ? null
      : `${dayInWords(evidence.performedOn)}${lastResult === null ? '' : `, ${evidenceResultLabel[lastResult]}`}`

  return {
    dutyId: duty.id,
    duty: duty.title,
    reference: source,
    document: intervalDocument === null ? null : documentWords(intervalDocument),
    interval: intervalWords(duty.shortened ?? dutyInterval(duty)),
    reason: duty.intervalReason,
    last: performed,
    performedOn: evidence?.performedOn ?? null,
    result: evidence === null || lastResult === null ? null : evidenceResultLabel[lastResult],
    evidenceId: evidence?.id ?? null,
    evidenceNumber: evidence?.number ?? null,
    mark:
      evidence === null
        ? evidenceRegisterWords.never
        : evidence.origin === 'legacy'
          ? evidenceRegisterWords.legacy
          : null,
    nextDue: duty.appointment?.dueOn ?? null,
  }
}

/**
 * The register in blocks: a block per asset by its number, then the places
 * that are no asset; within a block the duties by their name.
 */
export function evidenceRegisterBlocks(
  entries: readonly EvidenceRegisterEntry[],
): readonly EvidenceRegisterBlock[] {
  const blocks = new Map<
    string,
    {
      asset: EvidenceRegisterDuty['asset']
      placeId: string | null
      target: EvidenceRegisterBlock['target']
      entries: EvidenceRegisterEntry[]
    }
  >()

  for (const entry of entries) {
    const { duty } = entry
    const placeId = duty.asset === null ? (duty.roomId ?? duty.buildingId ?? duty.propertyId) : null
    const key = duty.asset === null ? `place:${String(placeId)}` : `asset:${duty.asset.id}`
    const { propertyId, buildingId, roomId, assetId } = duty
    const block = blocks.get(key) ?? {
      asset: duty.asset,
      placeId,
      target: { propertyId, buildingId, roomId, assetId },
      entries: [],
    }

    block.entries.push(entry)
    blocks.set(key, block)
  }

  // Assets first, by their number; the places that are no asset after them.
  const byPlace = (
    one: { asset: EvidenceRegisterDuty['asset'] },
    other: { asset: EvidenceRegisterDuty['asset'] },
  ) =>
    one.asset === null || other.asset === null
      ? Number(one.asset === null) - Number(other.asset === null)
      : byNameIn(one.asset.number ?? one.asset.name, other.asset.number ?? other.asset.name)

  return [...blocks.values()].sort(byPlace).map((block) => ({
    asset: block.asset,
    placeId: block.placeId,
    target: block.target,
    lines: block.entries
      .map(evidenceRegisterLine)
      .sort((one, other) => byNameIn(one.duty, other.duty)),
  }))
}

/** The columns of the register of evidence as a table, a row per duty. */
export const evidenceRegisterColumns = [
  'Anlage',
  'Ort',
  'Pflicht',
  'Fundstelle',
  'Dokument der Frist',
  'Frist',
  'Begründung',
  'Letzter Nachweis',
  'Ergebnis',
  'Nummer des Nachweises',
  'Kennzeichnung',
  'Nächste Fälligkeit',
] as const

/**
 * The register as the rows of a table: a row per duty, each with its asset
 * and place in words, as the caller names them for whoever reads it.
 */
export function evidenceRegisterRows(
  blocks: readonly EvidenceRegisterBlock[],
  named: (block: EvidenceRegisterBlock) => { readonly asset: string; readonly place: string },
): readonly TableRow[] {
  return blocks.flatMap((block) => {
    const { asset, place } = named(block)

    return block.lines.map((line): TableRow => [
      asset,
      place,
      line.duty,
      line.reference,
      line.document,
      line.interval,
      line.reason,
      line.performedOn === null ? null : { day: line.performedOn },
      line.result,
      line.evidenceNumber,
      line.mark,
      line.nextDue === null ? null : { day: line.nextDue },
    ])
  })
}

/** What the register would hold, as the dialog says it before it is made: duties, assets and duties never recorded. */
export interface EvidenceRegisterCount {
  readonly duties: number
  readonly assets: number
  readonly never: number
}

export function evidenceRegisterCount(
  entries: readonly EvidenceRegisterEntry[],
): EvidenceRegisterCount {
  return {
    duties: entries.length,
    assets: new Set(
      entries.flatMap((entry) => (entry.duty.asset === null ? [] : [entry.duty.asset.id])),
    ).size,
    never: entries.filter((entry) => entry.duty.lastEvidence === null).length,
  }
}
