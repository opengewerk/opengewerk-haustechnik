import type { IsoDate } from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  consumptionByKeyDate,
  isKeyDate,
  keyDateFor,
  keyDateIn,
  keyDayOf,
  meterExchangeProblems,
  meterFigure,
  meterPauseProblems,
  meterPointProblems,
  meterReadingProblems,
  meterSettingsProblems,
  readingDoubt,
  readingJump,
  meterRestsOn,
  validReadings,
} from './meter-reading.js'

const day = (value: string) => value as IsoDate

/** A reading for a key date, read on the key date itself. */
const reading = (keyDate: string, valueMilli: number) => ({
  keyDate: day(keyDate),
  readOn: day(keyDate),
  valueMilli,
})

const nothing = { exchanges: [], pauses: [], conversionFactor: null }

describe('the key date of a reading', () => {
  it('is the first of the nearest month: of this one up to the 15th, of the next after it', () => {
    expect(keyDateFor(day('2026-10-05'))).toBe('2026-10-01')
    expect(keyDateFor(day('2026-10-15'))).toBe('2026-10-01')
    expect(keyDateFor(day('2026-10-16'))).toBe('2026-11-01')
    expect(keyDateFor(day('2026-04-30'))).toBe('2026-05-01')
    expect(keyDateFor(day('2026-12-31'))).toBe('2027-01-01')
    expect(isKeyDate('2026-10-01')).toBe(true)
    expect(isKeyDate('2026-10-28')).toBe(true)
    expect(isKeyDate('2026-10-29')).toBe(false)
    expect(isKeyDate('2026-13-01')).toBe(false)
  })

  it('falls on the day the operator sets, or the one of the measuring point, the same up to 14 days after it', () => {
    expect(keyDateFor(day('2026-10-14'), 15)).toBe('2026-10-15')
    expect(keyDateFor(day('2026-10-29'), 15)).toBe('2026-10-15')
    expect(keyDateFor(day('2026-10-30'), 15)).toBe('2026-11-15')
    expect(keyDateFor(day('2026-12-30'), 28)).toBe('2026-12-28')
    expect(keyDateFor(day('2027-01-11'), 28)).toBe('2026-12-28')
    expect(keyDateFor(day('2027-01-12'), 28)).toBe('2027-01-28')
    expect(keyDateIn(day('2026-02-20'), 28)).toBe('2026-02-28')
    expect(keyDayOf({ keyDay: 15 }, { keyDay: 1 })).toBe(15)
    expect(keyDayOf({ keyDay: null }, { keyDay: 10 })).toBe(10)
    expect(keyDayOf(null, { keyDay: 1 })).toBe(1)
  })

  it('is never more than 14 days before the day it is read on, nor more than 17 after it', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 28 }),
        (date, keyDay) => {
          const readOn = day(date.toISOString().slice(0, 10))
          const keyDate = keyDateFor(readOn, keyDay)
          const apart = (Date.parse(keyDate) - Date.parse(readOn)) / 86_400_000

          expect(Number(keyDate.slice(8, 10))).toBe(keyDay)
          expect(apart).toBeGreaterThanOrEqual(-14)
          expect(apart).toBeLessThanOrEqual(17)
        },
      ),
    )
  })
})

describe('the consumption of a measuring point', () => {
  it('is the difference of two readings, and nothing for the first', () => {
    const worked = consumptionByKeyDate({
      ...nothing,
      readings: [reading('2026-06-01', 4_721_500), reading('2026-05-01', 4_671_700)],
    })

    expect(worked.get(day('2026-05-01'))).toEqual({ kind: 'first' })
    expect(worked.get(day('2026-06-01'))).toEqual({ kind: 'consumed', milli: 49_800, months: 1 })
  })

  it('adds up over every key date to the last reading less the first, times the factor', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 2, maxLength: 24 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 200 }),
        (steps, start, factor) => {
          let value = start
          const readings = steps.map((step, index) => {
            value += step

            return reading(
              `${String(2020 + Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}-01`,
              value,
            )
          })
          const worked = consumptionByKeyDate({ ...nothing, conversionFactor: factor, readings })
          const total = [...worked.values()].reduce(
            (sum, each) => sum + (each.kind === 'consumed' ? each.milli : 0),
            0,
          )

          expect(total).toBe((value - (readings[0]?.valueMilli ?? 0)) * factor)
        },
      ),
    )
  })

  it('counts on both meters across a replacement, up to the old end and from the new start', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 1_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (before, toEnd, newStart, afterwards) => {
          const worked = consumptionByKeyDate({
            ...nothing,
            readings: [reading('2026-09-01', before), reading('2026-11-01', newStart + afterwards)],
            exchanges: [
              {
                exchangedOn: day('2026-10-14'),
                oldEndMilli: before + toEnd,
                newStartMilli: newStart,
              },
            ],
          })

          expect(worked.get(day('2026-11-01'))).toEqual({
            kind: 'consumed',
            milli: toEnd + afterwards,
            months: 2,
          })
        },
      ),
    )
  })

  it('leaves out a replacement before the reading before, and one after the reading', () => {
    const worked = consumptionByKeyDate({
      ...nothing,
      readings: [reading('2026-09-01', 5_000), reading('2026-10-01', 8_000)],
      exchanges: [
        { exchangedOn: day('2026-08-20'), oldEndMilli: 99_000, newStartMilli: 1_000 },
        { exchangedOn: day('2026-10-02'), oldEndMilli: 9_000, newStartMilli: 0 },
      ],
    })

    expect(worked.get(day('2026-10-01'))).toEqual({ kind: 'consumed', milli: 3_000, months: 1 })
  })

  it('has none for a time that rests altogether, and one for a time that rests in part', () => {
    const pauses = [{ startsOn: day('2026-08-01'), endsOn: day('2026-09-15') }]
    const worked = consumptionByKeyDate({
      ...nothing,
      pauses,
      readings: [
        reading('2026-07-01', 4_773_600),
        reading('2026-08-01', 4_812_000),
        reading('2026-09-01', 4_812_000),
        reading('2026-10-01', 4_820_000),
      ],
    })

    expect(worked.get(day('2026-08-01'))).toEqual({ kind: 'consumed', milli: 38_400, months: 1 })
    expect(worked.get(day('2026-09-01'))).toEqual({ kind: 'paused' })
    expect(worked.get(day('2026-10-01'))).toEqual({ kind: 'consumed', milli: 8_000, months: 1 })
    expect(meterRestsOn(pauses, day('2026-09-15'))).toBe(true)
    expect(meterRestsOn(pauses, day('2026-09-16'))).toBe(false)
    expect(meterRestsOn([{ startsOn: day('2026-08-01'), endsOn: null }], day('2030-01-01'))).toBe(
      true,
    )
  })

  it('counts the reading that corrects another, and not the one it corrects', () => {
    const first = { id: 'r-1', correctsId: null }
    const second = { id: 'r-2', correctsId: null }
    const correction = { id: 'r-3', correctsId: 'r-2' }

    expect(validReadings([first, second, correction])).toEqual([first, correction])
  })
})

describe('a figure in doubt', () => {
  const history = {
    ...nothing,
    readings: [reading('2026-08-01', 4_812_000), reading('2026-07-01', 4_773_600)],
  }

  it('is one smaller than the reading before it, which says how a replaced meter is entered', () => {
    expect(
      readingDoubt(
        { keyDate: day('2026-10-01'), readOn: day('2026-10-05'), valueMilli: 4_801_200 },
        history,
        'cubic_metres',
      ),
    ).toBe(
      'Kleiner als der letzte Stand vom 01.08.2026, 4.812,0 m³. Wurde der Zähler getauscht, dann über „Zählertausch“.',
    )
    expect(
      readingDoubt(
        { keyDate: day('2026-10-01'), readOn: day('2026-10-05'), valueMilli: 4_812_000 },
        history,
        'cubic_metres',
      ),
    ).toBeNull()
  })

  it('is one larger than the reading after it, where no meter was put in between', () => {
    expect(
      readingDoubt(
        { keyDate: day('2026-06-01'), readOn: day('2026-06-01'), valueMilli: 4_780_000 },
        history,
        'cubic_metres',
      ),
    ).toBe('Größer als der Stand danach vom 01.07.2026, 4.773,6 m³.')
  })

  it('is held against the first figure of a meter put in since the reading before', () => {
    const replaced = {
      ...history,
      exchanges: [
        { exchangedOn: day('2026-09-20'), oldEndMilli: 4_839_700, newStartMilli: 10_000 },
      ],
    }

    expect(
      readingDoubt(
        { keyDate: day('2026-10-01'), readOn: day('2026-10-05'), valueMilli: 12_300 },
        replaced,
        'cubic_metres',
      ),
    ).toBeNull()
    expect(
      readingDoubt(
        { keyDate: day('2026-10-01'), readOn: day('2026-10-05'), valueMilli: 9_000 },
        replaced,
        'cubic_metres',
      ),
    ).toBe('Kleiner als der Anfangsstand des neuen Zählers, 10,0 m³.')
  })
})

describe('a figure that jumps', () => {
  const history = {
    ...nothing,
    readings: [reading('2026-09-01', 1_271_020), reading('2026-08-01', 1_258_000)],
  }
  const on = (valueMilli: number) => ({
    keyDate: day('2026-10-01'),
    readOn: day('2026-10-05'),
    valueMilli,
  })

  it('is nine times the reading before and more, which asks about the comma', () => {
    expect(readingJump(on(12_843_600), history)).toBe(
      'Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?',
    )
    expect(readingJump(on(127_000_000), history)).toBe(
      'Etwa hundertmal so viel wie im Vormonat. Stimmt das Komma?',
    )
  })

  it('is a consumption ten times the one of the month before, which asks about the figure', () => {
    // 13,02 before; 140 now is about 10.8 times as much.
    expect(readingJump(on(1_411_020), history)).toBe(
      'Etwa zehnmal so viel verbraucht wie im Monat davor. Stimmt der Stand?',
    )
    expect(readingJump(on(1_400_000), history)).toBeNull()
    expect(readingJump(on(1_284_360), history)).toBeNull()
  })

  it('is nothing to compare without a reading before or across a replacement', () => {
    expect(readingJump(on(12_843_600), { ...nothing, readings: [] })).toBeNull()
    expect(
      readingJump(on(12_843_600), {
        ...history,
        exchanges: [{ exchangedOn: day('2026-09-20'), oldEndMilli: 1_280_000, newStartMilli: 0 }],
      }),
    ).toBeNull()
  })
})

describe('a figure of a meter', () => {
  it('shows the places of its unit', () => {
    expect(meterFigure(4_812_000, 'cubic_metres')).toBe('4.812,0 m³')
    expect(meterFigure(1_284_360, 'megawatt_hours')).toBe('1.284,36 MWh')
    expect(meterFigure(214_880_000, 'kilowatt_hours')).toBe('214.880 kWh')
  })
})

describe('the rules of what a measuring point holds', () => {
  it('ask a reading for a key date, a day, a figure, and a reason with a correction', () => {
    expect(
      meterReadingProblems({ keyDate: '2026-10-01', readOn: '2026-10-05', valueMilli: 1 }),
    ).toEqual({})
    expect(meterReadingProblems({ keyDate: '2026-10-29' })).toEqual({
      keyDate: 'Der Stichtag ist ein Tag eines Monats vom 1. bis zum 28.',
    })
    expect(meterReadingProblems({ valueMilli: -1 })).toEqual({
      valueMilli: 'Der Stand ist eine Zahl ab 0.',
    })
    expect(meterReadingProblems({ correctsId: 'r-1', correctionReason: ' ' })).toEqual({
      correctionReason: 'Eine Berichtigung nennt ihren Grund.',
    })
  })

  it('ask a replacement for the number of the new meter and two figures', () => {
    expect(meterExchangeProblems({ newNumber: '', oldEndMilli: -5, newStartMilli: 0 })).toEqual({
      newNumber: 'Die Zählernummer des neuen Zählers fehlt.',
      oldEndMilli: 'Der Endstand ist eine Zahl ab 0.',
    })
  })

  it('ask a pause for its reason, and an end not before its start', () => {
    expect(
      meterPauseProblems({ startsOn: '2026-08-01', endsOn: '2026-07-31', reason: 'Ferien' }),
    ).toEqual({ endsOn: 'Der letzte Tag liegt nicht vor dem ersten.' })
    expect(meterPauseProblems({ startsOn: '2026-08-01', endsOn: null, reason: '' })).toEqual({
      reason: 'Der Grund fehlt.',
    })
  })

  it('ask a measuring point for a whole factor from 1 and a key day from 1 to 28', () => {
    expect(meterPointProblems({ conversionFactor: 40, keyDay: 15 })).toEqual({})
    expect(meterPointProblems({ conversionFactor: 0, keyDay: 29 })).toEqual({
      conversionFactor: 'Der Wandlerfaktor ist eine ganze Zahl von 1 bis 100000.',
      keyDay: 'Der Stichtag ist ein Tag im Monat von 1 bis 28.',
    })
  })

  it('ask the operator for a key day from 1 to 28', () => {
    expect(meterSettingsProblems({ keyDay: 1 })).toEqual({})
    expect(meterSettingsProblems({ keyDay: 0 })).toEqual({
      keyDay: 'Der Stichtag ist ein Tag im Monat von 1 bis 28.',
    })
    expect(meterSettingsProblems({})).toEqual({
      keyDay: 'Der Stichtag ist ein Tag im Monat von 1 bis 28.',
    })
  })
})
