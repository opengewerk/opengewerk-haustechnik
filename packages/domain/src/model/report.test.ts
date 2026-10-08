import { describe, expect, it } from 'vitest'

import { reportDefectField, reportProblems, takesAReport } from './report.js'

const today = '2026-10-08'
const hash = 'a'.repeat(64)
const classes = new Set(['allgemein.minor', 'allgemein.significant'])
const knows = (key: string) => classes.has(key)

/** A report with defects that nothing is wrong with. */
const sound = {
  performedOn: '2026-10-02',
  result: 'with_defects',
  resultReason: null,
  examiner: 'Klaus Berger',
  examinerOrganisation: 'Brandschutz Beispiel GmbH',
  file: {
    sha256: hash,
    fileName: 'pruefbericht-feuerloescher-2026-10.pdf',
    sizeBytes: 1_800_000,
    previewSha256: null,
  },
  defects: [
    { description: 'Wandhalterung locker', defectClass: 'allgemein.minor', dueOn: '2026-10-16' },
  ],
}

describe('a report of a contractor', () => {
  it('is sound with the file, a past day, a result, the examiner and the defects it names', () => {
    expect(reportProblems(sound, today, knows)).toEqual({})
    expect(reportProblems({ ...sound, performedOn: today }, today, knows)).toEqual({})
    expect(
      reportProblems({ ...sound, result: 'without_defects', defects: [] }, today, knows),
    ).toEqual({})
    expect(reportProblems({ ...sound, result: 'failed' }, today, knows)).toEqual({})
    expect(reportProblems({ ...sound, result: 'failed', defects: [] }, today, knows)).toEqual({})
    expect(
      reportProblems(
        {
          ...sound,
          result: 'not_performed',
          resultReason: 'Der Raum war verschlossen.',
          defects: [],
        },
        today,
        knows,
      ),
    ).toEqual({})
  })

  it('comes with its file, named and counted', () => {
    expect(reportProblems({ ...sound, file: undefined }, today, knows)).toEqual({
      file: 'Der Bericht oder die Prüfbescheinigung fehlt.',
    })
    expect(
      reportProblems({ ...sound, file: { ...sound.file, sha256: 'nohash' } }, today, knows),
    ).toEqual({ file: 'Der Bericht oder die Prüfbescheinigung fehlt.' })
    expect(
      reportProblems({ ...sound, file: { ...sound.file, fileName: ' ' } }, today, knows),
    ).toEqual({ file: 'Die Datei hat keinen Namen.' })
    expect(
      reportProblems(
        { ...sound, file: { ...sound.file, fileName: `${'x'.repeat(252)}.pdf` } },
        today,
        knows,
      ),
    ).toEqual({ file: 'Der Name der Datei hat höchstens 255 Zeichen.' })
    expect(
      reportProblems({ ...sound, file: { ...sound.file, sizeBytes: -1 } }, today, knows),
    ).toEqual({ file: 'Die Größe der Datei fehlt.' })
    expect(
      reportProblems({ ...sound, file: { ...sound.file, previewSha256: 'x' } }, today, knows),
    ).toEqual({ file: 'Die Vorschau der Datei ist keine Datei.' })
  })

  it('names the day of the test, which lies in the past, and the result', () => {
    expect(
      reportProblems({ ...sound, performedOn: undefined, result: undefined }, today, knows),
    ).toEqual({
      performedOn: 'Der Tag der Durchführung fehlt.',
      result: 'Das Ergebnis fehlt.',
    })
    expect(reportProblems({ ...sound, performedOn: '2026-10-09' }, today, knows)).toEqual({
      performedOn: 'Ein Nachweis gilt für einen Tag, der schon war.',
    })
    expect(
      reportProblems(
        { ...sound, result: 'not_performed', resultReason: null, defects: [] },
        today,
        knows,
      ),
    ).toEqual({ resultReason: 'Was nicht durchgeführt wurde, nennt den Grund.' })
  })

  it('always names the examiner and the organisation', () => {
    expect(
      reportProblems({ ...sound, examiner: '', examinerOrganisation: null }, today, knows),
    ).toEqual({
      examiner: 'Ein Bericht nennt den Prüfer.',
      examinerOrganisation: 'Ein Bericht nennt die Organisation des Prüfers.',
    })
    expect(reportProblems({ ...sound, examiner: 'x'.repeat(201) }, today, knows)).toEqual({
      examiner: 'Der Name des Prüfers hat höchstens 200 Zeichen.',
    })
  })

  it('names defects with defects, none without and none when not performed', () => {
    expect(reportProblems({ ...sound, defects: [] }, today, knows)).toEqual({
      defects: 'Mit Mängeln heißt, der Bericht nennt mindestens einen Mangel.',
    })
    expect(reportProblems({ ...sound, result: 'without_defects' }, today, knows)).toEqual({
      defects: 'Ohne Mangel heißt, der Bericht nennt keinen Mangel.',
    })
    expect(
      reportProblems(
        { ...sound, result: 'not_performed', resultReason: 'Der Raum war verschlossen.' },
        today,
        knows,
      ),
    ).toEqual({ defects: 'Was nicht durchgeführt wurde, nennt keinen Mangel.' })
    expect(
      reportProblems(
        { ...sound, defects: Array.from({ length: 51 }, () => sound.defects[0]) },
        today,
        knows,
      ),
    ).toEqual({
      defects: 'Ein Bericht nennt höchstens 50 Mängel; mehr kommen mit den Sammelnachweisen.',
    })
    expect(reportProblems({ ...sound, defects: 'eins' }, today, knows)).toEqual({
      defects: 'Die Mängel sind eine Liste.',
    })
  })

  it('takes each defect as found on the day of the test, of a class the catalogue knows', () => {
    const second = { description: '', defectClass: 'allgemein.unknown', dueOn: '2026-10-01' }

    expect(reportProblems({ ...sound, defects: [sound.defects[0], second] }, today, knows)).toEqual(
      {
        [reportDefectField(1, 'description')]: 'Die Beschreibung fehlt.',
        [reportDefectField(1, 'defectClass')]:
          'Diese Klasse steht für diesen Mangel nicht zur Wahl.',
        [reportDefectField(1, 'dueOn')]:
          'Die Frist zur Beseitigung liegt nicht vor dem Tag der Feststellung.',
      },
    )
    expect(
      reportProblems(
        { ...sound, defects: [{ description: 'Schild fehlt', defectClass: null, dueOn: null }] },
        today,
        knows,
      ),
    ).toEqual({})
  })
})

describe('a duty that takes a report', () => {
  const kindTaking = (...kinds: string[]) => ({ definition: { evidence: { kinds } } })

  it('is one of the operator own, and one whose kind names the report among its ways', () => {
    expect(takesAReport({ kind: null }, null)).toBe(true)
    expect(takesAReport({ kind: 'probe.main' }, kindTaking('protocol', 'report'))).toBe(true)
  })

  it('is not one whose kind names other ways, nor one of a kind the catalogue does not know', () => {
    expect(takesAReport({ kind: 'probe.interim' }, kindTaking('protocol', 'work_order'))).toBe(
      false,
    )
    expect(takesAReport({ kind: 'probe.gone' }, null)).toBe(false)
  })
})
