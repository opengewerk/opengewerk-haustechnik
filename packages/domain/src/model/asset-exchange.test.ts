import { describe, expect, it } from 'vitest'

import {
  exchangeLimits,
  exchangeProblems,
  exchangeReason,
  exchangeRefusal,
  exchangeRefusals,
} from './asset-exchange.js'

const today = '2026-10-12'
const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`

describe('what an exchange says beside the new asset', () => {
  it('names its day, today or a day before it', () => {
    expect(exchangeProblems({ on: today }, today)).toEqual({})
    expect(exchangeProblems({ on: '2026-10-01' }, today)).toEqual({})
    expect(exchangeProblems({}, today)).toEqual({
      on: 'Der Tag des Tauschs fehlt oder ist keiner.',
    })
    expect(exchangeProblems({ on: '12.10.2026' }, today)).toEqual({
      on: 'Der Tag des Tauschs fehlt oder ist keiner.',
    })
    expect(exchangeProblems({ on: '2026-10-13' }, today)).toEqual({
      on: 'Der Tag des Tauschs ist heute oder ein Tag davor: eingetragen wird ein Tausch, der stattgefunden hat.',
    })
  })

  it('takes components and duties along as lists of ids, each once', () => {
    expect(exchangeProblems({ on: today, components: [id(1)], duties: [] }, today)).toEqual({})
    expect(Object.keys(exchangeProblems({ on: today, components: 'alle' }, today))).toEqual([
      'components',
    ])
    expect(Object.keys(exchangeProblems({ on: today, components: [id(1), id(1)] }, today))).toEqual(
      ['components'],
    )
    expect(Object.keys(exchangeProblems({ on: today, duties: ['eine'] }, today))).toEqual([
      'duties',
    ])
    expect(
      Object.keys(
        exchangeProblems(
          {
            on: today,
            duties: Array.from({ length: exchangeLimits.duties + 1 }, (_, at) => id(at)),
          },
          today,
        ),
      ),
    ).toEqual(['duties'])
  })
})

describe('whether an asset is exchanged on a day', () => {
  const plain = { lifecycle: [], meter: false, replaced: false }

  it('is, with no life cycle at all and after its last entry', () => {
    expect(exchangeRefusal(plain, today)).toBeNull()
    expect(
      exchangeRefusal(
        {
          ...plain,
          lifecycle: [
            { state: 'in_service', validFrom: '2014-09-03' },
            { state: 'out_of_service', validFrom: '2026-10-11' },
          ],
        },
        today,
      ),
    ).toBeNull()
  })

  it('is not a second time', () => {
    expect(exchangeRefusal({ ...plain, replaced: true }, today)).toBe(exchangeRefusals.replaced)
  })

  it('is not as an asset when it is a measuring point', () => {
    expect(exchangeRefusal({ ...plain, meter: true }, today)).toBe(exchangeRefusals.meter)
  })

  it('is not once it was removed, while one decommissioned still is', () => {
    expect(
      exchangeRefusal(
        { ...plain, lifecycle: [{ state: 'removed', validFrom: '2026-09-01' }] },
        today,
      ),
    ).toBe(exchangeRefusals.removed)
    expect(
      exchangeRefusal(
        { ...plain, lifecycle: [{ state: 'decommissioned', validFrom: '2026-09-01' }] },
        today,
      ),
    ).toBeNull()
  })

  it('is not on a day that holds a state already', () => {
    expect(
      exchangeRefusal(
        { ...plain, lifecycle: [{ state: 'out_of_service', validFrom: today }] },
        today,
      ),
    ).toBe(exchangeRefusals.dayTaken)
  })

  it('is not before an entry that is there', () => {
    expect(
      exchangeRefusal(
        {
          ...plain,
          lifecycle: [
            { state: 'in_service', validFrom: '2014-09-03' },
            { state: 'out_of_service', validFrom: '2026-10-10' },
          ],
        },
        '2026-10-05',
      ),
    ).toBe(exchangeRefusals.laterEntry)
  })
})

describe('the reason an exchange leaves behind', () => {
  it('names the asset that stands there now', () => {
    expect(exchangeReason('AN-00412')).toBe(
      'Die Anlage wurde getauscht, an ihrer Stelle steht AN-00412.',
    )
  })
})
