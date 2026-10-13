import type { TableRecord } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  meterImportFields,
  type MeterImportMeter,
  meterImportSummary,
  meterImportTotal,
  planMeters,
} from './import-meters.js'

const today = '2026-10-13'

const water: MeterImportMeter = {
  id: 'm-water',
  number: 'AN-00101',
  name: 'Wasserzähler Haus A',
  mark: 'WZ-A',
  serialNumber: 'SN 88',
  meterNumber: 'W-2001',
  unit: 'cubic_metres',
  keyDay: 1,
  conversionFactor: null,
  readings: [],
  exchanges: [],
  pauses: [],
}

const power: MeterImportMeter = {
  ...water,
  id: 'm-power',
  number: 'AN-00102',
  name: 'Stromzähler Haus A',
  mark: 'EZ-A',
  serialNumber: null,
  meterNumber: 'E-77',
  unit: 'kilowatt_hours',
}

/** An asset that is no measuring point: it has no meter number. */
const pump: MeterImportMeter = {
  ...water,
  id: 'a-pump',
  number: 'AN-00200',
  name: 'Umwälzpumpe',
  mark: 'P-1',
  serialNumber: null,
  meterNumber: null,
}

/** The lines of a list as the plan reads them, the first in line 2 of the file. */
function records(lines: readonly Readonly<Record<string, string>>[]): TableRecord[] {
  return lines.map((values, at) => ({ line: at + 2, values }))
}

function plan(
  lines: readonly Readonly<Record<string, string>>[],
  meters: readonly MeterImportMeter[] = [water, power, pump],
) {
  return planMeters(records(lines), { meters, today })
}

const whats = (found: ReturnType<typeof plan>) => found.problems.map((problem) => problem.what)

describe('the fields of a list of the history of meters', () => {
  it('names each field once and needs none of them for every line', () => {
    const keys = meterImportFields.map((field) => field.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(meterImportFields.some((field) => field.required === true)).toBe(false)
  })
})

describe('a reading of a list', () => {
  it('becomes the reading for the key date of its day, in thousandths of the unit', () => {
    const found = plan([{ meterNumber: 'W-2001', day: '31.01.2026', value: '4812,5' }])

    expect(found.problems).toEqual([])
    expect(found.create.readings).toEqual([
      {
        line: 2,
        assetId: 'm-water',
        keyDate: '2026-02-01',
        readOn: '2026-01-31',
        valueMilli: 4_812_500,
        jumpConfirmed: false,
      },
    ])
    expect(found.counts).toEqual({ readings: 1, exchanges: 0, pauses: 0, known: 0 })
    expect(found.rows).toEqual([
      {
        line: 2,
        meter: {
          id: 'm-water',
          number: 'AN-00101',
          name: 'Wasserzähler Haus A',
          meterNumber: 'W-2001',
        },
        entry: 'reading',
        day: '2026-01-31',
        what: '4.812,5 m³ zum Stichtag 01.02.2026',
        jump: null,
      },
    ])
  })

  it('finds its measuring point by the meter number, the number here, the mark or the serial number', () => {
    const found = plan([
      { meterNumber: 'w-2001', day: '2026-01-31', value: '10' },
      { assetNumber: 'AN-00101', day: '2026-02-28', value: '20' },
      { mark: 'wz-a', day: '2026-03-31', value: '30' },
      { serialNumber: 'sn88', day: '2026-04-30', value: '40' },
    ])

    expect(found.problems).toEqual([])
    expect(found.create.readings.map((reading) => reading.assetId)).toEqual([
      'm-water',
      'm-water',
      'm-water',
      'm-water',
    ])
  })

  it('names no measuring point with a line that says none, or one that is not here', () => {
    const found = plan([
      { day: '31.01.2026', value: '10' },
      { meterNumber: 'X-1', day: '31.01.2026', value: '10' },
    ])

    expect(whats(found)).toEqual([
      'Die Messstelle fehlt: Zählernummer, Anlagennummer, Kennzeichen oder Seriennummer',
      'Eine Anlage mit der Zählernummer „X-1“ gibt es in Ihren Bereichen nicht',
    ])
  })

  it('is refused at an asset that is no measuring point', () => {
    const found = plan([{ mark: 'P-1', day: '31.01.2026', value: '10' }])

    expect(whats(found)).toEqual([
      'AN-00200 ist keine Messstelle: die Anlage hat keine Zählernummer',
    ])
    expect(found.create.readings).toEqual([])
  })

  it('is refused where two ways of naming it mean two assets', () => {
    const found = plan([{ meterNumber: 'W-2001', mark: 'EZ-A', day: '31.01.2026', value: '10' }])

    expect(whats(found)).toEqual([
      'Zählernummer „W-2001“ und Kennzeichen „EZ-A“ gehören zu verschiedenen Anlagen',
    ])
  })

  it('follows the key day of its measuring point', () => {
    const found = plan(
      [{ meterNumber: 'W-2001', day: '31.01.2026', value: '10' }],
      [{ ...water, keyDay: 15 }],
    )

    expect(found.create.readings[0]?.keyDate).toBe('2026-02-15')
  })

  it('reads a figure with a comma, and with the unit of its meter behind it', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '31.01.2026', value: '4812 m³' },
      { meterNumber: 'W-2001', day: '28.02.2026', value: '4830,125 m3' },
      { meterNumber: 'E-77', day: '31.01.2026', value: '120500 kWh' },
    ])

    expect(found.problems).toEqual([])
    expect(found.create.readings.map((reading) => reading.valueMilli)).toEqual([
      4_812_000, 4_830_125, 120_500_000,
    ])
  })

  it.each([
    ['4.812', 'a point between the thousands'],
    ['4812,1234', 'more places than a thousandth'],
    ['4812 kWh', 'the unit of another meter'],
    ['-5', 'a figure below nought'],
    ['viel', 'no figure'],
  ])('refuses the figure „%s“: %s', (value) => {
    const found = plan([{ meterNumber: 'W-2001', day: '31.01.2026', value }])

    expect(whats(found)).toEqual([
      `Der Stand ist eine Zahl in m³ mit höchstens drei Stellen hinter dem Komma, geschrieben ohne Tausenderpunkt wie 4812 oder 4812,5, und nicht „${value}“`,
    ])
  })

  it('needs its figure and its day', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '31.01.2026' },
      { meterNumber: 'W-2001', value: '10' },
      { meterNumber: 'W-2001', day: '31.02.2026', value: '10' },
    ])

    expect(whats(found)).toEqual([
      'Der Stand fehlt',
      'Der Tag der Ablesung fehlt',
      'Der Tag der Ablesung ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02',
    ])
  })

  it('is not read on a day that has not come', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '13.10.2026', value: '10' },
      { meterNumber: 'W-2001', day: '14.10.2026', value: '20' },
    ])

    expect(whats(found)).toEqual(['Abgelesen wird heute oder früher, nicht in der Zukunft'])
    expect(found.problems[0]?.lines).toEqual([3])
  })

  it('is known where the measuring point has the same figure for its key date, and makes nothing', () => {
    const found = plan(
      [
        { meterNumber: 'W-2001', day: '31.01.2026', value: '4812' },
        { meterNumber: 'W-2001', day: '28.02.2026', value: '4830' },
      ],
      [
        {
          ...water,
          readings: [{ keyDate: '2026-02-01', readOn: '2026-02-01', valueMilli: 4_812_000 }],
        },
      ],
    )

    expect(found.problems).toEqual([])
    expect(found.counts).toEqual({ readings: 1, exchanges: 0, pauses: 0, known: 1 })
    expect(found.create.readings.map((reading) => reading.line)).toEqual([3])
  })

  it('is a line to clear up where the measuring point has another figure for its key date', () => {
    const found = plan(
      [{ meterNumber: 'W-2001', day: '31.01.2026', value: '4800' }],
      [
        {
          ...water,
          readings: [{ keyDate: '2026-02-01', readOn: '2026-02-01', valueMilli: 4_812_000 }],
        },
      ],
    )

    expect(found.problems).toEqual([
      {
        lines: [2],
        what: 'Für den Stichtag 01.02.2026 steht an AN-00101 schon der Stand 4.812,0 m³',
        next: 'Den Stand an der Messstelle berichtigen oder die Zeile entfernen',
      },
    ])
  })

  it('stands once for a key date in a list', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '20.01.2026', value: '4800' },
      { meterNumber: 'W-2001', day: '02.02.2026', value: '4812' },
    ])

    expect(found.problems).toEqual([
      {
        lines: [2, 3],
        what: 'Für den Stichtag 01.02.2026 nennt die Liste an AN-00101 zwei Stände',
        next: 'Einen der beiden entfernen und neu hochladen',
      },
    ])
  })

  it('is not smaller than the reading before it, in the list or at the measuring point', () => {
    const inTheList = plan([
      { meterNumber: 'W-2001', day: '31.01.2026', value: '4812' },
      { meterNumber: 'W-2001', day: '28.02.2026', value: '4700' },
    ])
    const atThePoint = plan(
      [{ meterNumber: 'W-2001', day: '28.02.2026', value: '4700' }],
      [
        {
          ...water,
          readings: [{ keyDate: '2026-02-01', readOn: '2026-01-31', valueMilli: 4_812_000 }],
        },
      ],
    )

    // Each of the two says it of itself: the one above is larger than the one below.
    expect(inTheList.problems).toEqual([
      {
        lines: [2],
        what: '4.812,0 m³ an AN-00101: Größer als der Stand danach vom 01.03.2026, 4.700,0 m³',
        next: 'In der Datei berichtigen und neu hochladen',
      },
      {
        lines: [3],
        what: '4.700,0 m³ an AN-00101: Kleiner als der letzte Stand vom 01.02.2026, 4.812,0 m³',
        next: 'Wurde der Zähler getauscht, den Tausch als Zeile nennen; sonst in der Datei berichtigen',
      },
    ])
    expect(atThePoint.problems).toEqual([{ ...inTheList.problems[1], lines: [2] }])
    expect(inTheList.create.readings).toEqual([])
  })

  it('far above the one before is taken over, said and marked as confirmed', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '31.01.2026', value: '100' },
      { meterNumber: 'W-2001', day: '28.02.2026', value: '1000' },
    ])

    expect(found.problems).toEqual([])
    expect(found.create.readings.map((reading) => reading.jumpConfirmed)).toEqual([false, true])
    // Said apart from what is left out: these are taken over.
    expect(found.notes).toEqual([])
    expect(found.jumps).toEqual([
      {
        lines: [3],
        column: 'Stand',
        why: 'Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?',
      },
    ])
    expect(found.rows[1]?.jump).toBe('Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?')
  })
})

describe('the replacement of a meter in a list', () => {
  const exchange = {
    meterNumber: 'W-2001',
    entry: 'Tausch',
    day: '15.02.2026',
    oldNumber: 'W-1000',
    oldEnd: '5020',
    newNumber: 'W-2001',
    newStart: '0',
  }

  it('is taken over with both numbers and both figures, and lets the readings begin anew', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '31.01.2026', value: '5000' },
      exchange,
      { meterNumber: 'W-2001', day: '28.02.2026', value: '12' },
    ])

    expect(found.problems).toEqual([])
    expect(found.counts).toEqual({ readings: 2, exchanges: 1, pauses: 0, known: 0 })
    expect(found.create.exchanges).toEqual([
      {
        line: 3,
        assetId: 'm-water',
        exchangedOn: '2026-02-15',
        oldNumber: 'W-1000',
        oldEndMilli: 5_020_000,
        newNumber: 'W-2001',
        newStartMilli: 0,
      },
    ])
    expect(found.rows[1]).toMatchObject({
      line: 3,
      entry: 'exchange',
      day: '2026-02-15',
      what: 'Zähler W-1000 mit 5.020,0 m³ gegen W-2001 mit 0,0 m³',
    })
  })

  it('is a replacement without the column "Eintrag" where the line names a new meter', () => {
    const { entry: _, ...unnamed } = exchange
    const found = plan([unnamed])

    expect(found.problems).toEqual([])
    expect(found.counts.exchanges).toBe(1)
  })

  it('ends in the meter the asset carries today', () => {
    const found = plan([{ ...exchange, newNumber: 'W-9999' }])

    expect(found.problems).toEqual([
      {
        lines: [2],
        what: 'Nach dem Tausch vom 15.02.2026 trägt AN-00101 den Zähler „W-9999“, an der Anlage steht „W-2001“',
        next: 'Die Zählernummer der Anlage oder die Liste berichtigen',
      },
    ])
    expect(found.create.exchanges).toEqual([])
  })

  it('takes out the meter the replacement before it put in', () => {
    const found = plan([
      { ...exchange, day: '15.02.2024', oldNumber: 'W-0001', newNumber: 'W-0500' },
      { ...exchange, oldNumber: 'W-1000' },
    ])

    expect(found.problems).toEqual([
      {
        lines: [2, 3],
        what: 'An AN-00101 wird am 15.02.2024 der Zähler „W-0500“ eingebaut und am 15.02.2026 der Zähler „W-1000“ ausgebaut',
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })

  it('follows a replacement the measuring point holds already', () => {
    const held = {
      exchangedOn: '2024-02-15',
      oldNumber: 'W-0001',
      oldEndMilli: 900_000,
      newNumber: 'W-1000',
      newStartMilli: 0,
    } as const
    const follows = plan([exchange], [{ ...water, exchanges: [held] }])
    const breaks = plan([{ ...exchange, oldNumber: 'W-0777' }], [{ ...water, exchanges: [held] }])

    expect(follows.problems).toEqual([])
    expect(whats(breaks)).toEqual([
      'An AN-00101 wird am 15.02.2024 der Zähler „W-1000“ eingebaut und am 15.02.2026 der Zähler „W-0777“ ausgebaut',
    ])
    expect(breaks.problems[0]?.lines).toEqual([2])
  })

  it('is known where the measuring point holds the same one for the day, and refused with other figures', () => {
    const held = {
      exchangedOn: '2026-02-15',
      oldNumber: 'W-1000',
      oldEndMilli: 5_020_000,
      newNumber: 'W-2001',
      newStartMilli: 0,
    } as const
    const same = plan([exchange], [{ ...water, exchanges: [held] }])
    const other = plan([{ ...exchange, oldEnd: '5021' }], [{ ...water, exchanges: [held] }])

    expect(same.problems).toEqual([])
    expect(same.counts).toEqual({ readings: 0, exchanges: 0, pauses: 0, known: 1 })
    expect(other.problems).toEqual([
      {
        lines: [2],
        what: 'Am 15.02.2026 steht an AN-00101 schon ein Tausch mit anderen Angaben',
        next: 'Die Zeile entfernen: der Tausch an der Messstelle bleibt, wie er ist',
      },
    ])
  })

  it('stands once for a day in a list', () => {
    const found = plan([exchange, { ...exchange, oldEnd: '5021' }])

    expect(found.problems.map((problem) => problem.lines)).toEqual([[2, 3]])
  })

  it('ends the old meter at or above its last reading', () => {
    const found = plan([{ meterNumber: 'W-2001', day: '31.01.2026', value: '5030' }, exchange])

    expect(whats(found)).toEqual([
      'Der Endstand 5.020,0 m³ an AN-00101 ist kleiner als der letzte Stand des alten Zählers vom 01.02.2026, 5.030,0 m³',
    ])
  })

  it('starts the new meter at or below the reading the measuring point has after it', () => {
    const found = plan(
      [{ ...exchange, newStart: '50' }],
      [
        {
          ...water,
          readings: [{ keyDate: '2026-03-01', readOn: '2026-02-28', valueMilli: 12_000 }],
        },
      ],
    )

    expect(whats(found)).toEqual([
      'Der Anfangsstand 50,0 m³ an AN-00101 ist größer als der Stand danach vom 01.03.2026, 12,0 m³',
    ])
  })

  it('holds a reading of the list against the first figure of the new meter', () => {
    const found = plan(
      [exchange, { meterNumber: 'W-2001', day: '28.02.2026', value: '12' }].map((line) =>
        'newStart' in line ? { ...line, newStart: '50' } : line,
      ),
    )

    expect(found.problems).toEqual([
      {
        lines: [3],
        what: '12,0 m³ an AN-00101: Kleiner als der Anfangsstand des neuen Zählers, 50,0 m³',
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })

  it('needs two different numbers, both figures and a day that has come', () => {
    const found = plan([
      { ...exchange, oldNumber: 'W-2001' },
      { ...exchange, oldNumber: '' },
      { ...exchange, oldEnd: '', newStart: '' },
      { ...exchange, day: '14.10.2026' },
      { ...exchange, newNumber: 'N'.repeat(61) },
    ])

    expect(whats(found)).toEqual([
      'Der neue Zähler hat eine andere Nummer als der alte',
      'Die alte Zählernummer fehlt',
      'Der Endstand fehlt',
      'Der Anfangsstand fehlt',
      'Getauscht wird heute oder früher, nicht in der Zukunft',
      'Die neue Zählernummer hat höchstens 60 Zeichen',
    ])
  })
})

describe('a period a measuring point rested, in a list', () => {
  const pause = {
    meterNumber: 'W-2001',
    entry: 'Stilllegung',
    day: '15.07.2025',
    until: '31.08.2025',
    reason: 'Sanierung der Steigleitung',
  }

  it('is taken over with its days and its reason, with an end or without', () => {
    const found = plan([pause, { ...pause, day: '01.10.2026', until: '' }])

    expect(found.problems).toEqual([])
    expect(found.create.pauses).toEqual([
      {
        line: 2,
        assetId: 'm-water',
        startsOn: '2025-07-15',
        endsOn: '2025-08-31',
        reason: 'Sanierung der Steigleitung',
      },
      {
        line: 3,
        assetId: 'm-water',
        startsOn: '2026-10-01',
        endsOn: null,
        reason: 'Sanierung der Steigleitung',
      },
    ])
    expect(found.rows.map((row) => row.what)).toEqual([
      'Ruht vom 15.07.2025 bis 31.08.2025: Sanierung der Steigleitung',
      'Ruht seit dem 01.10.2026: Sanierung der Steigleitung',
    ])
  })

  it('is one without the column "Eintrag" where the line names a reason', () => {
    const { entry: _, ...unnamed } = pause

    expect(plan([unnamed]).counts.pauses).toBe(1)
  })

  it('needs its reason, and an end that is not before its beginning', () => {
    const found = plan([
      { ...pause, reason: '' },
      { ...pause, until: '14.07.2025' },
      { ...pause, until: 'Sommer' },
      { ...pause, reason: 'x'.repeat(501) },
    ])

    expect(whats(found)).toEqual([
      'Der Grund der Stilllegung fehlt',
      'Der letzte Tag der Stilllegung liegt nicht vor dem ersten',
      'Der letzte Tag der Stilllegung ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02',
      'Der Grund hat höchstens 500 Zeichen',
    ])
  })

  it('is known where the measuring point rests those days already, and refused over another period', () => {
    const resting = {
      ...water,
      pauses: [{ startsOn: '2025-07-15', endsOn: '2025-08-31' }],
    } as const
    const same = plan([pause], [resting])
    const over = plan([{ ...pause, day: '20.08.2025', until: '10.09.2025' }], [resting])

    expect(same.problems).toEqual([])
    expect(same.counts).toEqual({ readings: 0, exchanges: 0, pauses: 0, known: 1 })
    expect(over.problems).toEqual([
      {
        lines: [2],
        what: 'AN-00101 ruht vom 15.07.2025 bis 31.08.2025 schon',
        next: 'Die Zeile entfernen oder die Stilllegung an der Messstelle beenden',
      },
    ])
  })

  it('does not lie over another one of the list, nor over one that runs on', () => {
    const found = plan([
      { ...pause, until: '' },
      { ...pause, day: '01.10.2026', until: '' },
    ])

    expect(found.problems).toEqual([
      {
        lines: [2, 3],
        what: 'AN-00101 ruht seit dem 15.07.2025 schon',
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })
})

describe('a list of the history of meters', () => {
  it('reads the column "Eintrag" in the words a list uses, and refuses a word it does not know', () => {
    const found = plan([
      { meterNumber: 'W-2001', entry: 'Ablesung', day: '31.01.2026', value: '10' },
      { meterNumber: 'W-2001', entry: 'Zählerstand', day: '28.02.2026', value: '20' },
      { meterNumber: 'W-2001', entry: 'Umbau', day: '31.03.2026', value: '30' },
    ])

    expect(found.problems).toEqual([
      {
        lines: [4],
        what: 'Der Eintrag „Umbau“ ist keiner von Stand, Tausch und Stilllegung',
        next: 'In der Datei berichtigen und neu hochladen',
      },
    ])
  })

  it('says what a line holds for another kind of entry, and takes the line over without it', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '31.01.2026', value: '10', until: '31.12.2026' },
      {
        meterNumber: 'W-2001',
        entry: 'Stilllegung',
        day: '01.03.2026',
        reason: 'Umbau',
        value: '11',
      },
    ])

    expect(found.problems).toEqual([])
    expect(found.notes).toEqual([
      { lines: [2], column: 'Bis', why: 'steht in einer Zeile „Stand“ und wird nicht übernommen' },
      {
        lines: [3],
        column: 'Stand',
        why: 'steht in einer Zeile „Stilllegung“ und wird nicht übernommen',
      },
    ])
    expect(found.counts).toEqual({ readings: 1, exchanges: 0, pauses: 1, known: 0 })
  })

  it('writes nothing while one line is to clear up', () => {
    const found = plan([
      { meterNumber: 'W-2001', day: '31.01.2026', value: '10' },
      { meterNumber: 'E-77', day: '31.01.2026', value: 'viel' },
    ])

    expect(found.counts.readings).toBe(1)
    expect(found.create).toEqual({ readings: [], exchanges: [], pauses: [] })
  })

  it('says in words what was taken over', () => {
    expect(meterImportSummary({ readings: 1204, exchanges: 3, pauses: 1, known: 7 })).toBe(
      '1.204 Zählerstände, 3 Zählertausche und 1 Stilllegung übernommen',
    )
    expect(meterImportSummary({ readings: 1, exchanges: 0, pauses: 0, known: 0 })).toBe(
      '1 Zählerstand übernommen',
    )
    expect(meterImportTotal({ readings: 2, exchanges: 3, pauses: 4, known: 9 })).toBe(9)
  })
})
