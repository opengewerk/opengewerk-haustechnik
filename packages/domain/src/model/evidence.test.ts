import { describe, expect, it } from 'vitest'

import { canonicalForm } from './canonical.js'
import {
  type EvidenceState,
  evidenceOriginLabel,
  evidenceOrigins,
  evidenceProblems,
  evidenceResultLabel,
  evidenceResults,
  evidenceStateVersion,
  meetsTheDuty,
  readableStateVersions,
  readEvidenceState,
  UnknownEvidenceStateError,
} from './evidence.js'

/**
 * A state of each version as a row carries it, written once and never
 * changed: the first as the server writes it since #26. A new version adds
 * its own here, and the test below turns red until it does.
 */
const storedStates: Readonly<Record<number, unknown>> = {
  1: JSON.parse(
    '{"activity":{"kind":"inspection","title":"Hauptprüfung Aufzug Haus A"},' +
      '"defects":[{"defectClass":null,"description":"Notruf im Fahrkorb ohne Verbindung.","dueOn":"2026-11-01"}],' +
      '"duty":{"counting":"betrsichv","interval":{"months":24},"kind":"probe.elevator_main_test","kindVersion":1,' +
      '"label":"Hauptprüfung der Aufzugsanlage","source":"§ 16 Abs. 3 BetrSichV"},' +
      '"files":[],"number":"NW-2026-00001","origin":"protocol","performedOn":"2026-10-01",' +
      '"performer":{"person":"Hanna Probe"},' +
      '"place":{"asset":{"kind":"probe.elevator","kindLabel":"Aufzugsanlage","name":"Aufzug","number":"AN-00001",' +
      '"serialNumber":null},"building":{"name":"Haus A","shortCode":null},' +
      '"property":{"address":"Hauptstraße 1, 68535 Edingen-Neckarhausen","name":"Campus"},"room":null},' +
      '"result":"with_defects","resultReason":null,' +
      '"retention":{"kind":"until_next_inspection","on":"2026-10-01"},' +
      '"signatures":[{"name":"Hanna Probe","role":"signer","signedAt":"2026-10-01T09:30:00.000Z"}],' +
      '"version":1,"writtenAt":"2026-10-01T09:31:12.345Z","writtenBy":"Hanna Probe"}',
  ),
}

describe('the result of a performance', () => {
  it('meets the duty when the work was done, with or without defects, and not otherwise', () => {
    expect(evidenceResults.filter(meetsTheDuty)).toEqual(['without_defects', 'with_defects'])
  })

  it('has a name for every result, in the words of the concept', () => {
    expect(evidenceResults.map((result) => evidenceResultLabel[result])).toEqual([
      'Ohne Mangel',
      'Mit Mängeln',
      'Nicht bestanden',
      'Nicht durchgeführt',
    ])
  })
})

describe('the origin of an evidence', () => {
  it('is one of the four ways of ADR 0004 or the holdings of a predecessor', () => {
    expect(evidenceOrigins).toEqual(['protocol', 'report', 'round_point', 'work_order', 'legacy'])
    expect(evidenceOrigins.map((origin) => evidenceOriginLabel[origin])).toEqual([
      'Unterschriebenes Protokoll',
      'Bericht einer Fremdfirma oder Prüforganisation',
      'Punkt eines Rundgangs',
      'Abgenommener Arbeitsauftrag',
      'Altbestand aus einer Vorgängeranwendung',
    ])
  })
})

describe('the frozen state', () => {
  it('reads a state of the first version', () => {
    const state: EvidenceState = readEvidenceState(storedStates[1])

    expect(state.version).toBe(1)
    expect(state.number).toBe('NW-2026-00001')
    expect(state.duty.label).toBe('Hauptprüfung der Aufzugsanlage')
    expect(state.place.asset?.number).toBe('AN-00001')
    expect(state.defects).toEqual([
      {
        description: 'Notruf im Fahrkorb ohne Verbindung.',
        defectClass: null,
        dueOn: '2026-11-01',
      },
    ])
    expect(state.signatures[0]?.role).toBe('signer')
    // Stored in its canonical form, as the server writes it.
    expect(canonicalForm(storedStates[1])).toBe(JSON.stringify(storedStates[1]))
  })

  it('has a reader and a stored example for every version up to the newest', () => {
    const versions = Array.from({ length: evidenceStateVersion }, (_, index) => index + 1)

    expect(readableStateVersions).toEqual(versions)
    expect(Object.keys(storedStates).map(Number)).toEqual(versions)

    for (const version of versions) {
      expect(readEvidenceState(storedStates[version]).version).toBe(evidenceStateVersion)
    }
  })

  it('refuses a version it does not know, and what is no state at all', () => {
    const refused = (stored: unknown) => {
      try {
        readEvidenceState(stored)
      } catch (error) {
        return error instanceof UnknownEvidenceStateError ? error.message : String(error)
      }

      return 'read'
    }

    expect(refused({ version: evidenceStateVersion + 1 })).toBe(
      `Einen Stand der Fassung ${String(evidenceStateVersion + 1)} kennt dieser Leser nicht.`,
    )
    expect(refused({ version: '1' })).toBe('Einen Stand der Fassung 1 kennt dieser Leser nicht.')
    expect(refused(null)).toBe('Einen Stand der Fassung undefined kennt dieser Leser nicht.')
    expect(refused([1])).toBe('Einen Stand der Fassung undefined kennt dieser Leser nicht.')
  })
})

describe('what a person enters for an evidence', () => {
  it('names the reason it was not performed, and only then a reason', () => {
    expect(evidenceProblems({ result: 'not_performed' })).toEqual({
      resultReason: 'Was nicht durchgeführt wurde, nennt den Grund.',
    })
    expect(
      evidenceProblems({ result: 'not_performed', resultReason: 'Anlage war abgeschaltet.' }),
    ).toEqual({})
    expect(
      evidenceProblems({ result: 'failed', resultReason: 'Anlage war abgeschaltet.' }),
    ).toEqual({ resultReason: 'Einen Grund nennt nur, was nicht durchgeführt wurde.' })
    expect(evidenceProblems({ result: 'passed' })).toEqual({
      result:
        'Das Ergebnis ist eines von: Ohne Mangel, Mit Mängeln, Nicht bestanden, Nicht durchgeführt.',
    })
  })

  it('names an examiner from outside with the organisation, both or neither', () => {
    const together = 'Prüfer und Organisation stehen zusammen: wer von außen prüft, nennt beide.'

    expect(evidenceProblems({ examiner: 'Erika Muster' })).toEqual({
      examinerOrganisation: together,
    })
    expect(evidenceProblems({ examinerOrganisation: 'Prüfstelle Süd' })).toEqual({
      examiner: together,
    })
    expect(
      evidenceProblems({ examiner: 'Erika Muster', examinerOrganisation: 'Prüfstelle Süd' }),
    ).toEqual({})
    expect(evidenceProblems({ examiner: 'x'.repeat(201) })).toEqual({
      examiner: 'Der Name des Prüfers hat höchstens 200 Zeichen.',
    })
  })

  it('is performed on a day of the calendar', () => {
    expect(evidenceProblems({ performedOn: '2026-02-29' })).toEqual({
      performedOn: 'Der Tag der Durchführung ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(evidenceProblems({ performedOn: '2028-02-29' })).toEqual({})
  })
})
