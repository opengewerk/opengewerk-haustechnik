import { suggestedMapping, tableColumns, type TableSheet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { assetValueProblems } from './asset.js'
import { type KindField, kindFields } from './asset-values.js'
import type { AssetKind } from './catalogue.js'
import {
  cellHint,
  cellValue,
  freeColumns,
  kindColumnFields,
  kindColumnsProblem,
} from './import-kind-fields.js'

const heater: AssetKind = {
  label: 'Trinkwassererwärmung',
  costGroup: '412',
  characteristics: [
    { key: 'output', label: 'Nennleistung', kind: 'number', unit: 'kilowatts' },
    { key: 'outlet', label: 'Austrittstemperatur', kind: 'number', unit: 'decidegrees_celsius' },
    { key: 'circulation', label: 'Zirkulation', kind: 'flag' },
    {
      key: 'fuel',
      label: 'Energieträger',
      kind: 'choice',
      options: [
        { value: 'gas', label: 'Gas' },
        { value: 'power', label: 'Strom' },
      ],
    },
  ],
  fields: [
    { key: 'volume', label: 'Inhalt', kind: 'number', unit: 'm³' },
    { key: 'stops', label: 'Zapfstellen', kind: 'number' },
    { key: 'note', label: 'Bemerkung', kind: 'text' },
    { key: 'descaled', label: 'Zuletzt entkalkt', kind: 'date' },
  ],
  expectedDocuments: [],
  meter: null,
}

/** A switch whose types differ by a sign and nothing else, as those of a residual current device do. */
const breaker: AssetKind = {
  label: 'Fehlerstrom-Schutzeinrichtung',
  costGroup: '444',
  characteristics: [],
  fields: [
    {
      key: 'type',
      label: 'Typ',
      kind: 'choice',
      options: [
        { value: 'ac', label: 'AC' },
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'b_plus', label: 'B+' },
        { value: 'f', label: 'F' },
        { value: 'tn_c_s', label: 'TN-C-S' },
        { value: 'tn_c', label: 'TN-C' },
        { value: 'it', label: 'IT' },
      ],
    },
  ],
  expectedDocuments: [],
  meter: null,
}

const fieldOf = (kind: AssetKind, key: string): KindField => {
  const entry = kindFields(kind).find((each) => each.field.key === key)

  if (!entry) {
    throw new Error(`The kind has no field ${key}`)
  }

  return entry
}

/** What a cell is read as, and what the rule of the asset says about that. */
const read = (key: string, cell: string, kind: AssetKind = heater) => {
  const held = cellValue(fieldOf(kind, key), cell)

  return 'problem' in held
    ? held
    : { ...held, rule: Object.values(assetValueProblems(kind, { [key]: held.value })) }
}

describe('a cell of a list as the value of a field', () => {
  it('reads a figure in the steps of its unit, alone or with the unit behind it', () => {
    expect(read('output', '12')).toEqual({ value: 12, rule: [] })
    expect(read('output', '12 kW')).toEqual({ value: 12, rule: [] })
    expect(read('output', '12kw')).toEqual({ value: 12, rule: [] })
    expect(read('outlet', '60,5')).toEqual({ value: 605, rule: [] })
    expect(read('outlet', '60,5 °C')).toEqual({ value: 605, rule: [] })
    expect(read('outlet', '-2')).toEqual({ value: -20, rule: [] })
    expect(read('volume', '0,75')).toEqual({ value: 0.75, rule: [] })
    expect(read('volume', '1200 m3')).toEqual({ value: 1200, rule: [] })
    expect(read('stops', '4')).toEqual({ value: 4, rule: [] })
  })

  it('reads no figure with a point, with a gap between its thousands, in another unit or with words, and says how one stands', () => {
    expect(read('output', '7.5')).toEqual({
      problem:
        'Nennleistung ist eine Zahl in kW, geschrieben mit Komma und ohne Tausenderpunkt wie 1200, und nicht „7.5“.',
    })
    expect(read('outlet', '60.5')).toEqual({
      problem:
        'Austrittstemperatur ist eine Zahl in °C, geschrieben mit Komma und ohne Tausenderpunkt wie 1200 oder 7,5, und nicht „60.5“.',
    })
    expect(read('stops', '4 Stück')).toEqual({
      problem:
        'Zapfstellen ist eine Zahl, geschrieben mit Komma und ohne Tausenderpunkt wie 1200 oder 7,5, und nicht „4 Stück“.',
    })

    for (const cell of [
      '1.200',
      '1 200',
      '1.200,5',
      '7500 W',
      'ca. 12',
      'viele',
      '-',
      '12,',
      ',5',
    ]) {
      expect([cell, 'problem' in read('output', cell)]).toEqual([cell, true])
    }
  })

  it('reads the unit behind a figure across whatever space lies between them', () => {
    expect(read('output', '12   kW')).toEqual({ value: 12, rule: [] })
    expect(read('output', '12\n kW')).toEqual({ value: 12, rule: [] })
    expect(read('output', '12 \t ')).toEqual({ value: 12, rule: [] })
    expect('problem' in read('output', '12\n!')).toBe(true)
  })

  it('leaves a figure with more places than its unit has to the rule a form is held against', () => {
    expect(read('output', '7,5')).toEqual({
      value: 7.5,
      rule: ['Nennleistung ist eine ganze Zahl.'],
    })
    expect(read('outlet', '60,55')).toEqual({
      value: 605.5,
      rule: ['Austrittstemperatur ist eine ganze Zahl.'],
    })
  })

  it('reads yes and no as a list writes them, and hands on what is neither', () => {
    expect(read('circulation', 'ja')).toEqual({ value: true, rule: [] })
    expect(read('circulation', 'Nein')).toEqual({ value: false, rule: [] })
    expect(read('circulation', 'JA')).toEqual({ value: true, rule: [] })
    expect(read('circulation', 'x')).toEqual({
      value: 'x',
      rule: ['Zirkulation ist ja oder nein.'],
    })
    expect(read('circulation', 'vorhanden')).toEqual({
      value: 'vorhanden',
      rule: ['Zirkulation ist ja oder nein.'],
    })
  })

  it('reads a choice by the label of its option or by its value', () => {
    expect(read('fuel', 'Gas')).toEqual({ value: 'gas', rule: [] })
    expect(read('fuel', 'strom')).toEqual({ value: 'power', rule: [] })
    expect(read('fuel', 'power')).toEqual({ value: 'power', rule: [] })
    // By its value however it is written, as a label is: a list that came out of a program holds values.
    expect(read('fuel', 'POWER')).toEqual({ value: 'power', rule: [] })
    expect(read('fuel', 'Öl')).toEqual({
      value: 'Öl',
      rule: ['Energieträger ist eine von Gas, Strom.'],
    })
  })

  it('keeps options apart that differ by a sign: a choice is read by all it is written with', () => {
    expect(read('type', 'B', breaker)).toEqual({ value: 'b', rule: [] })
    expect(read('type', 'B+', breaker)).toEqual({ value: 'b_plus', rule: [] })
    expect(read('type', 'b +', breaker)).toEqual({ value: 'b_plus', rule: [] })
    expect(read('type', 'TN-C', breaker)).toEqual({ value: 'tn_c', rule: [] })
    expect(read('type', 'tn-c-s', breaker)).toEqual({ value: 'tn_c_s', rule: [] })
    // Without its hyphen it is neither of the two, and nothing is guessed.
    expect(read('type', 'TNC', breaker)).toMatchObject({ value: 'TNC' })
  })

  it('reads a day as a list or a program writes it, and hands on what names none', () => {
    expect(read('descaled', '03.10.2026')).toEqual({ value: '2026-10-03', rule: [] })
    expect(read('descaled', '2026-10-03')).toEqual({ value: '2026-10-03', rule: [] })
    expect(read('descaled', '3.10.26')).toEqual({
      value: '3.10.26',
      rule: ['Zuletzt entkalkt ist ein Tag, geschrieben 2026-10-03.'],
    })
    expect(read('descaled', '31.02.2026')).toMatchObject({ value: '31.02.2026' })
  })

  it('takes a text as it stands', () => {
    expect(read('note', 'Im Keller, hinter der Tür')).toEqual({
      value: 'Im Keller, hinter der Tür',
      rule: [],
    })
  })
})

describe('the fields of a kind as a column can be given them', () => {
  it('are called by their label, and a figure by its label with its unit as well', () => {
    expect(kindColumnFields(heater)).toEqual([
      { key: 'output', label: 'Nennleistung', names: ['Nennleistung kW', 'Nennleistung in kW'] },
      {
        key: 'outlet',
        label: 'Austrittstemperatur',
        names: ['Austrittstemperatur °C', 'Austrittstemperatur in °C'],
      },
      { key: 'circulation', label: 'Zirkulation' },
      { key: 'fuel', label: 'Energieträger' },
      { key: 'volume', label: 'Inhalt', names: ['Inhalt m³', 'Inhalt in m³'] },
      { key: 'stops', label: 'Zapfstellen' },
      { key: 'note', label: 'Bemerkung' },
      { key: 'descaled', label: 'Zuletzt entkalkt' },
    ])
  })

  it('propose the column that is called what a field is called, and no other', () => {
    const sheet: TableSheet = {
      name: '',
      rows: [
        ['Nennleistung (kW)', 'Inhalt in m³', 'zirkulation', 'Leistung', 'Bemerkungen'],
        ['12', '0,3', 'ja', '12', 'neu'],
      ],
    }

    expect(suggestedMapping(tableColumns(sheet), kindColumnFields(heater))).toEqual({
      output: 0,
      volume: 1,
      circulation: 2,
    })
  })
})

describe('what a column for a field holds, in words', () => {
  it('says the sort of each field, a figure with its unit and a choice with its options', () => {
    expect(kindFields(heater).map(cellHint)).toEqual([
      'Zahl in kW',
      'Zahl in °C',
      'ja oder nein',
      'Auswahl: Gas, Strom',
      'Zahl in m³',
      'Zahl',
      'Text',
      'Tag',
    ])
  })

  it('spells out six options and counts the rest', () => {
    expect(cellHint(fieldOf(breaker, 'type'))).toBe(
      'Auswahl: AC, A, B, B+, F, TN-C-S und 2 weitere',
    )
  })
})

describe('the columns of a sheet and the fields of asset kinds', () => {
  const sheet: TableSheet = {
    name: '',
    rows: [
      ['Objekt', 'Haus', 'Art', 'Name', 'Leistung', 'Inhalt', '', 'Typ'],
      ['Schule', 'Altbau', 'Speicher', 'Speicher 1', '12', '0,3', 'ja', 'B+'],
    ],
  }
  const mapping = { property: 0, building: 1, kind: 2, name: 3 }
  const kindOf = (key: string) => (key === 'heater' ? heater : key === 'breaker' ? breaker : null)
  const problemOf = (columns: unknown) => kindColumnsProblem(columns, kindOf, mapping, sheet)

  it('leave to the kinds what the first step gave no field', () => {
    expect(freeColumns(sheet, mapping).map((column) => [column.index, column.name])).toEqual([
      [4, 'Leistung'],
      [5, 'Inhalt'],
      [6, ''],
      [7, 'Typ'],
    ])
    expect(freeColumns(sheet, { ...mapping, model: 7 }).map((column) => column.index)).toEqual([
      4, 5, 6,
    ])
  })

  it('are a choice a request may leave out, and one two kinds may share a column in', () => {
    expect(problemOf(undefined)).toBeNull()
    expect(problemOf({})).toBeNull()
    expect(problemOf({ heater: {} })).toBeNull()
    expect(problemOf({ heater: { output: 4, volume: 5, circulation: 6 } })).toBeNull()
    expect(problemOf({ heater: { output: 4 }, breaker: { type: 4 } })).toBeNull()
  })

  it('are no choice in another shape', () => {
    const shape =
      'Die Felder einer Anlagenart stehen als Anlagenart mit ihren Feldern und deren Spalten.'

    for (const wrong of [null, 'heater', 4, [], [{ heater: { output: 4 } }]]) {
      expect([wrong, problemOf(wrong)]).toEqual([wrong, shape])
    }

    for (const wrong of [null, 'output', 4, [4]]) {
      expect([wrong, problemOf({ heater: wrong })]).toEqual([wrong, shape])
    }
  })

  it('name a kind of the catalogue and a field that kind has', () => {
    expect(problemOf({ pump: { output: 4 } })).toBe(
      'Die Anlagenart pump kennt kein Paket des Katalogs.',
    )
    expect(problemOf({ breaker: { output: 4 } })).toBe(
      'Das Feld output hat die Anlagenart Fehlerstrom-Schutzeinrichtung nicht.',
    )
    expect(problemOf({ heater: { toString: 4 } })).toBe(
      'Das Feld toString hat die Anlagenart Trinkwassererwärmung nicht.',
    )
  })

  it('read a column of the sheet, and none of it twice in a kind', () => {
    for (const wrong of [8, -1, 1.5, '4', null]) {
      expect([wrong, problemOf({ heater: { output: wrong } })]).toEqual([
        wrong,
        'Die Spalte für „Nennleistung“ gibt es in der Datei nicht.',
      ])
    }

    expect(problemOf({ heater: { output: 4, stops: 4 } })).toBe(
      'Die Spalte E ist zwei Feldern der Anlagenart Trinkwassererwärmung zugeordnet.',
    )
  })

  it('leave alone a column the first step gave a field', () => {
    expect(problemOf({ heater: { note: 3 } })).toBe(
      'Die Spalte D ist schon im ersten Schritt einem Feld zugeordnet.',
    )
  })
})
