import type { TableRecord } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  templateImportFields,
  templateImportSummary,
  templatePointKinds,
  planTemplates,
} from './import-templates.js'
import { templateProblems } from './round-template.js'

/** The lines of a list as the plan reads them, the first in line 2 of the file. */
function records(lines: readonly Readonly<Record<string, string>>[]): TableRecord[] {
  return lines.map((values, at) => ({ line: at + 2, values }))
}

function plan(lines: readonly Readonly<Record<string, string>>[], here: readonly string[] = []) {
  return planTemplates(records(lines), { templates: here.map((title) => ({ title })) })
}

const whats = (found: ReturnType<typeof plan>) => found.problems.map((problem) => problem.what)
const round = 'Technikrundgang Haus A'

describe('the fields of a list of templates', () => {
  it('names each field once and needs the template and the point', () => {
    const keys = templateImportFields.map((field) => field.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(
      templateImportFields.filter((field) => field.required === true).map((field) => field.key),
    ).toEqual(['template', 'point'])
  })
})

describe('a list of templates', () => {
  it('makes a template of the lines that name it, the chapters and points in the order of the list', () => {
    const found = plan([
      { template: round, chapter: 'Heizung', point: 'Kessel ohne Störung' },
      { template: round, chapter: 'Lüftung', point: 'Filter sauber', hint: 'Sichtprüfung' },
      { template: round, chapter: 'Heizung', point: 'Druck im Soll' },
      { template: 'Wochenrundgang', chapter: 'Außen', point: 'Wege frei' },
    ])

    expect(found.problems).toEqual([])
    expect(found.create.templates).toEqual([
      {
        line: 2,
        asksCountersignature: false,
        definition: {
          title: round,
          sections: [
            {
              key: 'k1',
              title: 'Heizung',
              fields: [
                { key: 'p1', label: 'Kessel ohne Störung', kind: 'check_point' },
                { key: 'p3', label: 'Druck im Soll', kind: 'check_point' },
              ],
            },
            {
              key: 'k2',
              title: 'Lüftung',
              fields: [
                { key: 'p2', label: 'Filter sauber', hint: 'Sichtprüfung', kind: 'check_point' },
              ],
            },
          ],
        },
      },
      {
        line: 5,
        asksCountersignature: false,
        definition: {
          title: 'Wochenrundgang',
          sections: [
            {
              key: 'k1',
              title: 'Außen',
              fields: [{ key: 'p1', label: 'Wege frei', kind: 'check_point' }],
            },
          ],
        },
      },
    ])
    expect(found.counts).toEqual({ templates: 2, chapters: 3, points: 4, known: 0 })
    expect(found.rows).toEqual([
      { line: 2, title: round, chapters: 2, points: 3, limits: 0, asksCountersignature: false },
      {
        line: 5,
        title: 'Wochenrundgang',
        chapters: 1,
        points: 1,
        limits: 0,
        asksCountersignature: false,
      },
    ])
  })

  it('makes what the editor and the route take: a version without a problem', () => {
    const [template] = plan([
      { template: round, chapter: 'Heizung', point: 'Kessel ohne Störung' },
      {
        template: round,
        point: 'Vorlauf',
        kind: 'Messwert',
        unit: '°C',
        atLeast: '55',
        limitSource: 'Betriebsanweisung Heizung',
      },
      { template: round, point: 'Zustand', kind: 'Auswahl', options: 'gut; mittel ;schlecht' },
    ]).create.templates

    expect(template).toBeDefined()
    expect(
      templateProblems(template?.definition ?? { title: '', sections: [] }, {
        record: () => false,
        duty: () => null,
        ruleUnits: () => null,
        assetKind: () => false,
        dutyKind: () => null,
      }),
    ).toEqual({})
  })

  it('puts a line without a chapter into the one above it, and the first into "Kapitel 1"', () => {
    const found = plan([
      { template: round, point: 'Erster' },
      { template: round, chapter: 'Lüftung', point: 'Zweiter' },
      { template: round, point: 'Dritter' },
    ])

    expect(
      found.create.templates[0]?.definition.sections.map((section) => [
        section.title,
        section.fields.map((field) => field.label),
      ]),
    ).toEqual([
      ['Kapitel 1', ['Erster']],
      ['Lüftung', ['Zweiter', 'Dritter']],
    ])
  })

  it('leaves a template that is here already as it is, whatever its capitals', () => {
    const found = plan(
      [
        { template: 'technikrundgang haus a', chapter: 'Heizung', point: 'Kessel' },
        { template: 'Wochenrundgang', chapter: 'Außen', point: 'Wege frei' },
      ],
      [round],
    )

    expect(found.problems).toEqual([])
    expect(found.counts).toEqual({ templates: 1, chapters: 1, points: 1, known: 1 })
    expect(found.create.templates.map((template) => template.definition.title)).toEqual([
      'Wochenrundgang',
    ])
  })

  it('needs the template and the point of every line', () => {
    const found = plan([
      { chapter: 'Heizung', point: 'Kessel' },
      { template: round, chapter: 'Heizung' },
    ])

    expect(whats(found)).toEqual(['Die Vorlage fehlt', 'Der Punkt fehlt'])
    expect(found.create.templates).toEqual([])
  })

  it('asks for the countersignature where a line of the template says so', () => {
    const found = plan([
      { template: round, point: 'Kessel', countersignature: 'ja' },
      { template: round, point: 'Druck' },
      { template: 'Wochenrundgang', point: 'Wege frei', countersignature: 'nein' },
    ])

    expect(found.create.templates.map((template) => template.asksCountersignature)).toEqual([
      true,
      false,
    ])
    expect(found.rows.map((row) => row.asksCountersignature)).toEqual([true, false])
  })

  it('refuses a template whose lines say yes and no to the countersignature, and a word that is neither', () => {
    const found = plan([
      { template: round, point: 'Kessel', countersignature: 'ja' },
      { template: round, point: 'Druck', countersignature: 'nein' },
      { template: 'Wochenrundgang', point: 'Wege frei', countersignature: 'vielleicht' },
    ])

    expect(found.problems).toEqual([
      {
        lines: [2, 3],
        what: `Die Vorlage „${round}“ verlangt die Gegenzeichnung in einer Zeile und in einer anderen nicht`,
        next: 'In der Datei berichtigen und neu hochladen',
      },
      {
        lines: [4],
        what: 'Die Gegenzeichnung ist ja oder nein, nicht „vielleicht“',
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })
})

describe('a point of a list', () => {
  const point = (values: Readonly<Record<string, string>>) =>
    plan([{ template: round, chapter: 'Heizung', point: 'Punkt', ...values }])
  const fieldOf = (values: Readonly<Record<string, string>>) =>
    point(values).create.templates[0]?.definition.sections[0]?.fields[0]

  it('is a check point unless the list names another kind, by the words of the editor', () => {
    expect(fieldOf({})).toEqual({ key: 'p1', label: 'Punkt', kind: 'check_point' })
    expect(fieldOf({ kind: 'Foto' })).toEqual({ key: 'p1', label: 'Punkt', kind: 'photo' })
    expect(fieldOf({ kind: 'ja oder nein' })).toEqual({ key: 'p1', label: 'Punkt', kind: 'yes_no' })
    expect(fieldOf({ kind: 'Text' })).toEqual({ key: 'p1', label: 'Punkt', kind: 'text' })
    expect(fieldOf({ kind: 'Bemerkung' })).toEqual({
      key: 'p1',
      label: 'Punkt',
      kind: 'text',
      multiline: true,
    })
  })

  it('knows every kind the editor offers', () => {
    expect(templatePointKinds.map((kind) => kind.label)).toEqual([
      'Prüfpunkt',
      'Messwert',
      'Zählerstand',
      'Foto',
      'Bemerkung',
      'Text',
      'Zahl',
      'Auswahl',
      'Ja oder nein',
    ])
  })

  it('of a kind the editor does not know is a line to clear up', () => {
    expect(whats(point({ kind: 'Unterschrift' }))).toEqual([
      'Die Art „Unterschrift“ ist keine von Prüfpunkt, Messwert, Zählerstand, Foto, Bemerkung, Text, Zahl, Auswahl und Ja oder nein',
    ])
  })

  it('is asked for where the list says so, and a measured value and a reading unless it says no', () => {
    expect(fieldOf({ required: 'ja' })).toMatchObject({ required: true })
    expect(fieldOf({ required: 'nein' })).not.toHaveProperty('required')
    expect(fieldOf({})).not.toHaveProperty('required')
    expect(fieldOf({ kind: 'Messwert', unit: '°C' })).toMatchObject({ required: true })
    expect(fieldOf({ kind: 'Messwert', unit: '°C', required: 'nein' })).not.toHaveProperty(
      'required',
    )
    expect(fieldOf({ kind: 'Zählerstand', unit: 'kWh' })).toMatchObject({ required: true })
    expect(whats(point({ required: 'manchmal' }))).toEqual([
      'Das Pflichtfeld ist ja oder nein, nicht „manchmal“',
    ])
  })

  it('that counts names its unit, by the sign of it', () => {
    expect(fieldOf({ kind: 'Messwert', unit: '°C' })).toMatchObject({
      kind: 'measurement',
      unit: 'degrees_celsius',
      decimals: 1,
    })
    expect(fieldOf({ kind: 'Messwert', unit: 'c' })).toMatchObject({ unit: 'degrees_celsius' })
    expect(fieldOf({ kind: 'Zählerstand', unit: 'm3' })).toEqual({
      key: 'p1',
      label: 'Punkt',
      kind: 'meter_reading',
      unit: 'cubic_metres',
      decimals: 1,
      required: true,
    })
    expect(fieldOf({ kind: 'Zählerstand', unit: 'kWh' })).toMatchObject({ decimals: 0 })
    expect(fieldOf({ kind: 'Zahl', unit: 'mA' })).toEqual({
      key: 'p1',
      label: 'Punkt',
      kind: 'number',
      unit: 'milliamperes',
      decimals: 0,
    })
    expect(whats(point({ kind: 'Messwert' }))).toEqual([
      'Die Einheit fehlt: ein Punkt der Art „Messwert“ nennt eine von °C, je 100 ml, kWh, MWh, m³, Ω, MΩ, mA, kg und ms',
    ])
    expect(whats(point({ kind: 'Messwert', unit: 'bar' }))).toEqual([
      'Die Einheit „bar“ ist keine von °C, je 100 ml, kWh, MWh, m³, Ω, MΩ, mA, kg und ms',
    ])
  })

  it('that reads a meter counts in a unit of a meter', () => {
    expect(whats(point({ kind: 'Zählerstand', unit: '°C' }))).toEqual([
      'Ein Zählerstand zählt in kWh, MWh oder m³, nicht in °C',
    ])
  })

  it('takes the decimal places the list names, from none to three', () => {
    expect(fieldOf({ kind: 'Messwert', unit: '°C', decimals: '0' })).toMatchObject({ decimals: 0 })
    expect(fieldOf({ kind: 'Zahl', unit: 'mA', decimals: '3' })).toMatchObject({ decimals: 3 })
    expect(whats(point({ kind: 'Messwert', unit: '°C', decimals: '4' }))).toEqual([
      'Die Nachkommastellen sind eine Zahl von 0 bis 3, nicht „4“',
    ])
  })

  it('that is a choice lists its possibilities, and needs two', () => {
    expect(fieldOf({ kind: 'Auswahl', options: 'gut; mittel ;schlecht;' })).toEqual({
      key: 'p1',
      label: 'Punkt',
      kind: 'choice',
      options: [
        { value: 'o1', label: 'gut' },
        { value: 'o2', label: 'mittel' },
        { value: 'o3', label: 'schlecht' },
      ],
    })
    expect(whats(point({ kind: 'Auswahl', options: 'gut' }))).toEqual([
      'Punkt „Punkt“: Eine Auswahl braucht mindestens zwei Möglichkeiten',
    ])
  })

  it('that measures takes a limit the list states, at least or at most, with its source', () => {
    expect(
      fieldOf({ kind: 'Messwert', unit: '°C', atLeast: '55', limitSource: 'DVGW W 551' }),
    ).toMatchObject({
      limit: { kind: 'stated', bound: 'at_least', milli: 55_000, source: 'DVGW W 551' },
    })
    expect(
      fieldOf({ kind: 'Messwert', unit: '°C', atMost: '-18,5 °C', limitSource: 'Kühlhaus' }),
    ).toMatchObject({
      limit: { kind: 'stated', bound: 'at_most', milli: -18_500, source: 'Kühlhaus' },
    })
    expect(point({ kind: 'Messwert', unit: '°C', atLeast: '55', limitSource: 'x' }).rows).toEqual([
      { line: 2, title: round, chapters: 1, points: 1, limits: 1, asksCountersignature: false },
    ])
  })

  it('refuses a limit without its source, one with both bounds and one that is no figure', () => {
    expect(whats(point({ kind: 'Messwert', unit: '°C', atLeast: '55' }))).toEqual([
      'Punkt „Punkt“: Ein eigener Grenzwert braucht einen Wert und seine Quelle',
    ])
    expect(
      whats(point({ kind: 'Messwert', unit: '°C', atLeast: '55', atMost: '60', limitSource: 'x' })),
    ).toEqual(['Ein Messwert hat einen Grenzwert: mindestens oder höchstens, nicht beide'])
    expect(
      whats(point({ kind: 'Messwert', unit: '°C', atLeast: '1.055', limitSource: 'x' })),
    ).toEqual([
      'Der Grenzwert ist eine Zahl in °C mit höchstens drei Stellen hinter dem Komma, geschrieben ohne Tausenderpunkt wie 55 oder 7,5, und nicht „1.055“',
    ])
    expect(
      whats(point({ kind: 'Messwert', unit: '°C', atLeast: '55 bar', limitSource: 'x' })),
    ).toHaveLength(1)
  })

  it('says what a cell holds that its kind has no use for, and is taken over without it', () => {
    const found = point({
      unit: '°C',
      options: 'a;b',
      atLeast: '5',
      limitSource: 'x',
    })

    expect(found.problems).toEqual([])
    expect(found.notes).toEqual([
      {
        lines: [2],
        column: 'Einheit',
        why: 'gilt für keinen Punkt der Art „Prüfpunkt“ und wird nicht übernommen',
      },
      {
        lines: [2],
        column: 'Möglichkeiten',
        why: 'gilt nur für eine Auswahl und wird nicht übernommen',
      },
      {
        lines: [2],
        column: 'Mindestens',
        why: 'gilt nur für einen Messwert und wird nicht übernommen',
      },
      {
        lines: [2],
        column: 'Quelle des Grenzwerts',
        why: 'gilt nur für einen Messwert und wird nicht übernommen',
      },
    ])
    expect(found.create.templates[0]?.definition.sections[0]?.fields).toEqual([
      { key: 'p1', label: 'Punkt', kind: 'check_point' },
    ])
    expect(
      point({ kind: 'Messwert', unit: '°C', limitSource: 'x' }).notes.map((note) => note.why),
    ).toEqual(['steht ohne Grenzwert und wird nicht übernommen'])
  })
})

describe('what a template may hold', () => {
  it('is asked of a list as of the editor: a name too long is said at its line', () => {
    const found = plan([
      { template: 'T'.repeat(121), chapter: 'Heizung', point: 'Kessel' },
      { template: round, chapter: 'K'.repeat(121), point: 'Kessel' },
      { template: round, chapter: 'Heizung', point: 'P'.repeat(201) },
    ])

    expect(found.problems.map((problem) => [problem.lines, problem.what.split(': ')[1]])).toEqual([
      [[2], 'Die Bezeichnung hat höchstens 120 Zeichen'],
      [[3], 'Die Bezeichnung des Kapitels hat höchstens 120 Zeichen'],
      [[4], 'Die Bezeichnung hat höchstens 200 Zeichen'],
    ])
  })

  it('has at most two hundred points', () => {
    const found = plan(
      Array.from({ length: 201 }, (_, at) => ({ template: round, point: `Punkt ${String(at)}` })),
    )

    expect(found.problems).toEqual([
      {
        lines: [2],
        what: `Vorlage „${round}“: Eine Vorlage hat höchstens 200 Punkte`,
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })

  it('is no larger than a version may be kept', () => {
    const options = Array.from({ length: 30 }, (_, at) => `${String(at)} ${'x'.repeat(76)}`).join(
      ';',
    )
    const found = plan(
      Array.from({ length: 200 }, (_, at) => ({
        template: round,
        point: `Punkt ${String(at)}`,
        kind: 'Auswahl',
        options,
      })),
    )

    expect(found.problems).toEqual([
      {
        lines: [2],
        what: `Die Vorlage „${round}“ ist zu groß, um sie zu speichern`,
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })

  it('writes nothing while one line is to clear up', () => {
    const found = plan([
      { template: round, point: 'Kessel' },
      { template: 'Wochenrundgang', point: 'Wege', kind: 'Unterschrift' },
    ])

    expect(found.counts.templates).toBe(1)
    expect(found.create.templates).toEqual([])
  })

  it('says in words what was taken over', () => {
    expect(templateImportSummary({ templates: 3, chapters: 9, points: 86, known: 0 })).toBe(
      '3 Vorlagen mit 86 Punkten übernommen',
    )
    expect(templateImportSummary({ templates: 1, chapters: 1, points: 1, known: 0 })).toBe(
      '1 Vorlage mit 1 Punkt übernommen',
    )
  })
})
