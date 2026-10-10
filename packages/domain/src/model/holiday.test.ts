import { type IsoDate, ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { hasHolidays, holidayClosures, holidaysBetween } from './holiday.js'

// Three holidays of Baden-Württemberg as the package writes them, one of
// them ended, and a rule of a day of another state.
const catalogue = {
  ruleSet: ruleSet([
    {
      key: 'feiertage.unity_day',
      scope: 'DE-BW',
      validFrom: '1990-10-03' as IsoDate,
      validUntil: null,
      unit: 'month_day',
      value: 1003,
      source: 'Art. 2 Abs. 2 Einigungsvertrag',
      note: 'Tag der Deutschen Einheit',
    },
    {
      key: 'feiertage.easter_monday',
      scope: 'DE-BW',
      validFrom: '1995-05-08' as IsoDate,
      validUntil: null,
      unit: 'days_from_easter',
      value: 1,
      source: '§ 1 FTG',
      note: 'Ostermontag',
    },
    {
      key: 'feiertage.reformation_day',
      scope: 'DE-BW',
      validFrom: '2017-10-31' as IsoDate,
      validUntil: '2017-10-31' as IsoDate,
      unit: 'month_day',
      value: 1031,
      source: 'einmalig',
      note: 'Reformationstag',
    },
    {
      key: 'feiertage.assumption_day',
      scope: 'DE-BY',
      validFrom: '1980-01-01' as IsoDate,
      validUntil: null,
      unit: 'month_day',
      value: 815,
      source: 'Art. 1 FTG Bayern',
      note: 'Mariä Himmelfahrt',
    },
    {
      key: 'probe.interval',
      validFrom: '2015-06-01' as IsoDate,
      validUntil: null,
      unit: 'days',
      value: 1003,
      source: 'Probe',
    },
  ]),
}

const day = (on: string) => on as IsoDate

describe('the statutory public holidays of a state', () => {
  it('stand on their days, named by their rules, in the years they are in force', () => {
    expect(holidaysBetween(catalogue, 'DE-BW', day('2026-01-01'), day('2026-12-31'))).toEqual([
      { day: '2026-04-06', name: 'Ostermontag', source: '§ 1 FTG' },
      {
        day: '2026-10-03',
        name: 'Tag der Deutschen Einheit',
        source: 'Art. 2 Abs. 2 Einigungsvertrag',
      },
    ])
    expect(
      holidaysBetween(catalogue, 'DE-BW', day('2017-10-01'), day('2017-10-31')).map((h) => h.name),
    ).toEqual(['Tag der Deutschen Einheit', 'Reformationstag'])
  })

  it('are only the ones from the day to the day, over the turn of a year', () => {
    expect(
      holidaysBetween(catalogue, 'DE-BW', day('2026-10-04'), day('2027-04-30')).map((h) => h.day),
    ).toEqual(['2027-03-29'])
  })

  it('are none of another state, and none where the catalogue holds none, nor a rule in another unit', () => {
    expect(hasHolidays(catalogue, 'DE-BW')).toBe(true)
    expect(hasHolidays(catalogue, 'DE-BY')).toBe(true)
    expect(hasHolidays(catalogue, 'DE-HE')).toBe(false)
    expect(holidaysBetween(catalogue, 'DE-HE', day('2026-01-01'), day('2026-12-31'))).toEqual([])
    expect(
      holidaysBetween(catalogue, 'DE-BY', day('2026-01-01'), day('2026-12-31')).map((h) => h.name),
    ).toEqual(['Mariä Himmelfahrt'])
  })

  it('are days a plan makes no round on, with the holiday as the reason', () => {
    expect(
      holidayClosures([{ day: day('2026-04-06'), name: 'Ostermontag', source: '§ 1 FTG' }]),
    ).toEqual([{ startsOn: '2026-04-06', endsOn: '2026-04-06', reason: 'Ostermontag, Feiertag' }])
  })
})
