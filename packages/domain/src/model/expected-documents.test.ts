import { describe, expect, it } from 'vitest'

import type { ExpectedDocument } from './catalogue.js'
import {
  expectationsOf,
  expectedDocumentsAt,
  lackingDocuments,
  lacksFor,
} from './expected-documents.js'

const plan: ExpectedDocument = {
  key: 'circuit_diagram',
  label: 'Übersichtsschaltplan',
  kind: 'circuit_diagram',
  demand: 'required',
  source: 'DIN VDE 0100-510:2014-10, Abschnitt 514.5',
}
const report: ExpectedDocument = {
  key: 'initial_test_report',
  label: 'Protokoll der Erstprüfung',
  kind: 'test_certificate',
  demand: 'recommended',
  source: null,
}
// Written before #347: it names neither kind nor demand and counts for nothing.
const before: ExpectedDocument = {
  key: 'log_book',
  label: 'Betriebsbuch',
  kind: null,
  demand: null,
  source: null,
}
const installation = { expectedDocuments: [plan, before, report] }

describe('the documents a kind of asset expects', () => {
  it('are those that say what fulfils them, in the order of the package', () => {
    expect(expectationsOf(installation).map((expected) => expected.key)).toEqual([
      'circuit_diagram',
      'initial_test_report',
    ])
    expect(expectationsOf(null)).toEqual([])
  })

  it('are there only with a document of their kind at the asset, the first of it named', () => {
    const diagram = { id: 'd-1', kind: 'circuit_diagram' as const }
    const older = { id: 'd-2', kind: 'circuit_diagram' as const }
    const typePlate = { id: 'd-3', kind: null }
    const manual = { id: 'd-4', kind: 'operating_manual' as const }

    expect(
      expectedDocumentsAt(installation, [diagram, older, typePlate, manual]).map(
        ({ expected, document }) => [expected.key, document?.id ?? null],
      ),
    ).toEqual([
      ['circuit_diagram', 'd-1'],
      ['initial_test_report', null],
    ])
    // Without a document none is there: a document without a kind, or of another, fulfils none.
    expect(
      expectedDocumentsAt(installation, [typePlate, manual]).map(({ document }) => document),
    ).toEqual([null, null])
  })

  it('are missing again once the document of their kind is gone', () => {
    expect(lackingDocuments(installation, ['circuit_diagram', 'test_certificate'])).toEqual([])
    expect(lackingDocuments(installation, ['test_certificate']).map(({ key }) => key)).toEqual([
      'circuit_diagram',
    ])
    expect(lackingDocuments(installation, [null]).map(({ key }) => key)).toEqual([
      'circuit_diagram',
      'initial_test_report',
    ])
  })

  it('narrow the register to an asset that lacks any, or one that is required', () => {
    const lacking = lackingDocuments(installation, ['circuit_diagram'])

    expect(lacksFor('missing', lacking)).toBe(true)
    expect(lacksFor('required_missing', lacking)).toBe(false)
    expect(lacksFor('required_missing', lackingDocuments(installation, []))).toBe(true)
    expect(lacksFor('missing', [])).toBe(false)
  })
})
