import {
  type EvidenceState,
  evidenceStateVersion,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'

import { stateFingerprint } from '../evidence/fingerprint.js'

// For the tests that put an evidence in past the application, to count a
// duty's next due day from it or to see a policy at work: the columns a row
// needs beside its duty, day and result, with a state of the newest version
// and the fingerprint over it. What the state says is the least it can; what
// `writeEvidence` puts in it is shown in `evidence/write.test.ts`.

let numbers = 0

/** A number nobody else has, for a row put in past the sequence. */
export function nextEvidenceNumber(): string {
  numbers += 1

  return `NW-TEST-${String(numbers).padStart(5, '0')}`
}

/** The least state of an evidence of a report, in the newest version. */
export function leastState(number: string, performedOn: IsoDate, result: string): EvidenceState {
  return {
    version: evidenceStateVersion,
    number,
    origin: 'report',
    performedOn,
    result: result as EvidenceState['result'],
    resultReason: result === 'not_performed' ? 'Anlage war abgeschaltet.' : null,
    replaces: null,
    duty: {
      label: 'Hauptprüfung der Aufzugsanlage',
      kind: null,
      kindVersion: null,
      source: '§ 16 BetrSichV',
      interval: { months: 24 },
      counting: 'betrsichv',
    },
    place: {
      property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
      building: null,
      room: null,
      asset: null,
    },
    activity: null,
    performer: { examiner: 'Erika Muster', organisation: 'Prüfstelle Süd' },
    defects: [],
    signatures: [],
    files: [],
    retention: null,
    writtenBy: 'Probe',
    writtenAt: '2026-10-03T08:00:00.000Z',
  }
}

/**
 * The columns of a written evidence of a report beside its duty, day and
 * result, by their names in the database, for an insert written as SQL.
 */
export function writtenColumns(
  writtenBy: string,
  performedOn: IsoDate,
  result: string,
): {
  result_reason: string | null
  number: string
  origin: 'report'
  examiner: string
  examiner_organisation: string
  written_by: string
  state: string
  fingerprint: string
} {
  const number = nextEvidenceNumber()
  const state = leastState(number, performedOn, result)

  return {
    result_reason: state.resultReason,
    number,
    origin: 'report',
    examiner: 'Erika Muster',
    examiner_organisation: 'Prüfstelle Süd',
    written_by: writtenBy,
    state: JSON.stringify(state),
    fingerprint: stateFingerprint(state),
  }
}

/** The names of the columns `writtenColumns` gives, in its order, for the list of an insert. */
export const writtenColumnNames =
  'result_reason, number, origin, examiner, examiner_organisation, written_by, state, fingerprint'

/** The placeholders of the values of `writtenValues`, beginning with the one numbered `from`. */
export function writtenPlaceholders(from: number): string {
  return Array.from({ length: 8 }, (_, index) => `$${String(from + index)}`).join(', ')
}

/** The values of `writtenColumns` in the order of `writtenColumnNames`. */
export function writtenValues(
  writtenBy: string,
  performedOn: IsoDate,
  result: string,
): readonly unknown[] {
  const columns = writtenColumns(writtenBy, performedOn, result)

  return [
    columns.result_reason,
    columns.number,
    columns.origin,
    columns.examiner,
    columns.examiner_organisation,
    columns.written_by,
    columns.state,
    columns.fingerprint,
  ]
}
