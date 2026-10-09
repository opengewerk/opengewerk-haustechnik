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
  resultAgainstFindings,
  standingEvidence,
  statedReasonProblem,
  UnknownEvidenceStateError,
} from './evidence.js'

/**
 * A state of each version as a row carries it, written once and never
 * changed: the first as the server wrote it from the second part of #26, the
 * second with the evidence a correction replaces, from its fourth part, the
 * third with the form of the activity and the answers to its points (#106),
 * the fourth with what was said with the result (#108).
 * A new version adds its own here, and the test below turns red until it does.
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
  2: JSON.parse(
    '{"activity":null,"defects":[],' +
      '"duty":{"counting":"betrsichv","interval":{"months":24},"kind":"probe.elevator_main_test","kindVersion":1,' +
      '"label":"Hauptprüfung der Aufzugsanlage","source":"§ 16 Abs. 3 BetrSichV"},' +
      '"files":[],"number":"NW-2026-00002","origin":"report","performedOn":"2026-09-30",' +
      '"performer":{"examiner":"Erika Muster","organisation":"Prüfstelle Süd"},' +
      '"place":{"asset":{"kind":"probe.elevator","kindLabel":"Aufzugsanlage","name":"Aufzug","number":"AN-00001",' +
      '"serialNumber":null},"building":{"name":"Haus A","shortCode":null},' +
      '"property":{"address":"Hauptstraße 1, 68535 Edingen-Neckarhausen","name":"Campus"},"room":null},' +
      '"replaces":{"number":"NW-2026-00001","reason":"Der Prüfbericht nennt den 30. September."},' +
      '"result":"without_defects","resultReason":null,' +
      '"retention":{"kind":"until_next_inspection","on":"2026-09-30"},' +
      '"signatures":[],' +
      '"version":2,"writtenAt":"2026-10-02T14:05:00.000Z","writtenBy":"Hanna Probe"}',
  ),
  3: JSON.parse(
    '{"activity":{"kind":"inspection","title":"Prüfung Trinkwasser Haus A"},' +
      '"answers":[{"group":null,"kind":"measurement","label":"Temperatur am Speicheraustritt",' +
      '"limit":{"source":"DVGW W 551","text":"Außerhalb des Grenzwerts, mindestens 60,0 °C.","within":false},' +
      '"photo":null,"remark":"Speicher heizt nach.","result":null,"section":"Messwerte","value":"57,5 °C"},' +
      '{"group":{"block":1,"label":"Abgänge"},"kind":"check_point","label":"Dämmung","limit":null,' +
      '"photo":{"mediaType":"image/jpeg","name":"daemmung.jpg",' +
      '"sha256":"9f2c4e1a7b3d5f6081a2c3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718"},' +
      '"remark":"Dämmung am Abgang lose.","result":"not_ok","section":"Sichtprüfung","value":null}],' +
      '"defects":[{"defectClass":null,"description":"Abgänge, Block 1: Dämmung am Abgang lose.","dueOn":null}],' +
      '"duty":{"counting":"from_due","interval":{"months":12},"kind":"probe.drinking_water_check","kindVersion":1,' +
      '"label":"Prüfung der Trinkwasseranlage","source":"DVGW W 551"},' +
      '"files":[],"form":{"key":"probe.drinking_water_protocol","title":"Prüfprotokoll Trinkwasser","version":2},' +
      '"number":"NW-2026-00003","origin":"protocol","performedOn":"2026-10-07",' +
      '"performer":{"person":"Hanna Probe"},' +
      '"place":{"asset":{"kind":"probe.water_heater","kindLabel":"Trinkwassererwärmer","name":"Speicher",' +
      '"number":"AN-00002","serialNumber":null},"building":{"name":"Haus A","shortCode":null},' +
      '"property":{"address":"Hauptstraße 1, 68535 Edingen-Neckarhausen","name":"Campus"},"room":null},' +
      '"replaces":null,"result":"with_defects","resultReason":null,' +
      '"retention":{"kind":"until_next_inspection","on":"2026-10-07"},' +
      '"signatures":[{"name":"Hanna Probe","role":"signer","signedAt":"2026-10-07T10:58:00.000Z"}],' +
      '"version":3,"writtenAt":"2026-10-07T11:00:00.000Z","writtenBy":"Hanna Probe"}',
  ),
  4: JSON.parse(
    '{"activity":{"kind":"maintenance","title":"Sichtkontrolle Rückspülfilter Haus A"},' +
      '"answers":[],"defects":[],' +
      '"duty":{"counting":"from_due","interval":{"months":6},"kind":"probe.backwash_filter_check","kindVersion":1,' +
      '"label":"Sichtkontrolle des Rückspülfilters","source":"DIN EN 806-5"},' +
      '"files":[],"form":null,"number":"NW-2026-00004","origin":"protocol","performedOn":"2026-10-09",' +
      '"performer":{"person":"Hanna Probe"},' +
      '"place":{"asset":{"kind":"probe.backwash_filter","kindLabel":"Rückspülfilter","name":"Filter",' +
      '"number":"AN-00003","serialNumber":null},"building":{"name":"Haus A","shortCode":null},' +
      '"property":{"address":"Hauptstraße 1, 68535 Edingen-Neckarhausen","name":"Campus"},"room":null},' +
      '"remark":"Filter rückgespült, Siebeinsatz sauber.",' +
      '"replaces":null,"result":"without_defects","resultReason":null,' +
      '"retention":{"kind":"until_next_inspection","on":"2026-10-09"},' +
      '"signatures":[{"name":"Hanna Probe","role":"signer","signedAt":"2026-10-09T08:12:00.000Z"}],' +
      '"version":4,"writtenAt":"2026-10-09T08:12:30.000Z","writtenBy":"Hanna Probe"}',
  ),
}

describe('the result of a performance', () => {
  it('is not "ohne Mangel" while the activity holds a finding, and any other result is', () => {
    expect(resultAgainstFindings('without_defects', 1)).toBe(
      'Ein Vorgang, der einen Mangel festhält, ist nicht „ohne Mangel“.',
    )
    expect(resultAgainstFindings('without_defects', 0)).toBeNull()
    expect(
      (['with_defects', 'failed', 'not_performed', null] as const).map((result) =>
        resultAgainstFindings(result, 2),
      ),
    ).toEqual([null, null, null, null])
  })

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

    // In the newest shape: no evidence of the first version corrects another.
    expect(state.version).toBe(evidenceStateVersion)
    expect(state.replaces).toBeNull()
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

  it('reads a state of the second version, with the evidence a correction replaces', () => {
    const state = readEvidenceState(storedStates[2])

    // In the newest shape: no evidence of the second version names a form or answers.
    expect(state.version).toBe(evidenceStateVersion)
    expect([state.form, state.answers]).toEqual([null, []])
    expect(state.number).toBe('NW-2026-00002')
    expect(state.replaces).toEqual({
      number: 'NW-2026-00001',
      reason: 'Der Prüfbericht nennt den 30. September.',
    })
    expect(state.performer).toEqual({ examiner: 'Erika Muster', organisation: 'Prüfstelle Süd' })
    expect(canonicalForm(storedStates[2])).toBe(JSON.stringify(storedStates[2]))
  })

  it('reads a state of the third version, with the form and the answers to its points', () => {
    const state = readEvidenceState(storedStates[3])

    // In the newest shape: nothing was said with the result before the fourth version.
    expect(state.version).toBe(evidenceStateVersion)
    expect(state.remark).toBeNull()
    expect(state.form).toEqual({
      key: 'probe.drinking_water_protocol',
      title: 'Prüfprotokoll Trinkwasser',
      version: 2,
    })
    expect(state.answers.map((answer) => [answer.label, answer.value, answer.result])).toEqual([
      ['Temperatur am Speicheraustritt', '57,5 °C', null],
      ['Dämmung', null, 'not_ok'],
    ])
    expect(state.answers[0]?.limit).toEqual({
      text: 'Außerhalb des Grenzwerts, mindestens 60,0 °C.',
      source: 'DVGW W 551',
      within: false,
    })
    expect(state.answers[1]?.group).toEqual({ label: 'Abgänge', block: 1 })
    expect(canonicalForm(storedStates[3])).toBe(JSON.stringify(storedStates[3]))
  })

  it('reads a state of the fourth version, with what was said with the result', () => {
    const state = readEvidenceState(storedStates[4])

    expect(state.version).toBe(4)
    expect(state.remark).toBe('Filter rückgespült, Siebeinsatz sauber.')
    expect([state.form, state.answers, state.result]).toEqual([null, [], 'without_defects'])
    expect(canonicalForm(storedStates[4])).toBe(JSON.stringify(storedStates[4]))
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

describe('the evidence that counts for the due day', () => {
  const row = (id: string, replacesEvidenceId: string | null = null) => ({ id, replacesEvidenceId })

  it('is the evidence nobody replaced and nobody declared invalid', () => {
    const rows = [row('first'), row('second'), row('correction', 'first'), row('third')]

    expect(standingEvidence(rows, new Set()).map((entry) => entry.id)).toEqual([
      'second',
      'correction',
      'third',
    ])
    expect(standingEvidence(rows, new Set(['third'])).map((entry) => entry.id)).toEqual([
      'second',
      'correction',
    ])
  })

  it('leaves an evidence replaced when its correction is declared invalid in turn', () => {
    const rows = [row('first'), row('correction', 'first'), row('second correction', 'correction')]

    expect(standingEvidence(rows, new Set()).map((entry) => entry.id)).toEqual([
      'second correction',
    ])
    expect(standingEvidence(rows, new Set(['second correction']))).toEqual([])
  })
})

describe('the reason of a correction or a declaration of invalidity', () => {
  it('is given, and has at most as many characters as allowed', () => {
    const missing = 'Eine Berichtigung nennt ihren Grund.'

    expect(statedReasonProblem(undefined, 500, missing)).toBe(missing)
    expect(statedReasonProblem('   ', 500, missing)).toBe(missing)
    expect(statedReasonProblem(' Falscher Tag. ', 500, missing)).toBeUndefined()
    expect(statedReasonProblem('x'.repeat(500), 500, missing)).toBeUndefined()
    expect(statedReasonProblem('x'.repeat(501), 500, missing)).toBe(
      'Der Grund hat höchstens 500 Zeichen.',
    )
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
