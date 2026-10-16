import {
  type Catalogue,
  dutySourceWords,
  type EvidenceRegisterEntry,
  type EvidenceResult,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { inArray } from 'drizzle-orm'

import { intervalDocumentsOf } from '../database/interval-documents.js'
import { duties, evidence } from '../database/schema/index.js'
import { type DutyPlaceFilter, registeredEntries } from './duty-register.js'

/** What the register of evidence is asked for (#338): where, which asset kinds, and whether duties that ended stand in it. */
export interface EvidenceRegisterQuestion {
  readonly place: Pick<DutyPlaceFilter, 'propertyId' | 'areaId' | 'buildingId'>
  /** The keys of the asset kinds, none for every kind. */
  readonly assetKinds: readonly string[]
  readonly ended: boolean
}

/** The question out of an address: `propertyId`, `areaId`, `buildingId`, `assetKinds` separated by commas, `ended=1`. */
export function evidenceRegisterQuestion(
  query: Readonly<Record<string, unknown>>,
): EvidenceRegisterQuestion {
  const text = (key: string) =>
    typeof query[key] === 'string' && query[key] !== '' ? query[key] : undefined
  const place = {
    ...(text('propertyId') === undefined ? {} : { propertyId: text('propertyId') }),
    ...(text('areaId') === undefined ? {} : { areaId: text('areaId') }),
    ...(text('buildingId') === undefined ? {} : { buildingId: text('buildingId') }),
  }

  return {
    place,
    assetKinds: (text('assetKinds') ?? '')
      .split(',')
      .map((kind) => kind.trim())
      .filter((kind) => kind !== ''),
    ended: query['ended'] === '1',
  }
}

/**
 * Every duty the person sees that the question names, with the result of its
 * last evidence and the document that bears its interval. The transaction is
 * the person's, so nothing beyond their areas is in it (#338, acceptance 2):
 * the rows are those of the register of duties under the same choice.
 */
export async function evidenceRegisterEntries(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  question: EvidenceRegisterQuestion,
): Promise<readonly EvidenceRegisterEntry[]> {
  const read = (await registeredEntries(tx, catalogue, today, question.place)) ?? []
  const chosen = read.filter(
    (entry) =>
      (question.ended || !entry.ended) &&
      (question.assetKinds.length === 0 ||
        (entry.asset !== null && question.assetKinds.includes(entry.asset.kind))),
  )

  if (chosen.length === 0) {
    return []
  }

  const evidenceIds = chosen.flatMap((entry) =>
    entry.lastEvidence === null ? [] : [entry.lastEvidence.id],
  )
  const results = new Map(
    evidenceIds.length === 0
      ? []
      : (
          await tx
            .select({ id: evidence.id, result: evidence.result })
            .from(evidence)
            .where(inArray(evidence.id, evidenceIds))
        ).map((row) => [row.id as string, row.result as EvidenceResult]),
  )
  const pointing = await tx
    .select({
      id: duties.id,
      intervalDocumentId: duties.intervalDocumentId,
      intervalDocumentVersionId: duties.intervalDocumentVersionId,
    })
    .from(duties)
    .where(
      inArray(
        duties.id,
        chosen.map((entry) => entry.id),
      ),
    )
  const documents = await intervalDocumentsOf(tx, pointing)

  return chosen.map((entry) => {
    const document = documents.get(entry.id) ?? null

    return {
      duty: entry,
      source: dutySourceWords(entry, catalogue),
      lastResult: entry.lastEvidence === null ? null : (results.get(entry.lastEvidence.id) ?? null),
      intervalDocument:
        document === null
          ? null
          : {
              title: document.title,
              version: document.version.number,
              datedOn: document.version.filedOn,
            },
    }
  })
}
