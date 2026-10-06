import { describe, expect, it } from 'vitest'

import {
  dutyFilterOf,
  dutyPlaces,
  dutyRegisterPlace,
  dutyRegisterRequest,
  dutySearch,
} from './duty-addresses.js'

/**
 * How the address of the register of duties carries what it is narrowed by
 * (#101): read from the address, written into it, and handed to the server.
 */

describe('the filters an address of the register of duties names', () => {
  it('are read word by word, each as the key the data model has for it', () => {
    expect(
      dutyFilterOf({
        zustand: 'overdue',
        liegenschaft: 'p-1',
        gebaeude: 'b-1',
        art: 'probe.elevator',
        pflichtart: 'probe.elevator_main_test',
        verantwortlich: 'u-roth',
      }),
    ).toEqual({
      state: 'overdue',
      propertyId: 'p-1',
      buildingId: 'b-1',
      assetKind: 'probe.elevator',
      dutyKind: 'probe.elevator_main_test',
      responsible: 'u-roth',
    })
  })

  it('hold a state there is, the ended duties among them, and no state there is none of', () => {
    expect(dutyFilterOf({ zustand: 'ended' })).toEqual({ state: 'ended' })
    expect(dutyFilterOf({ zustand: 'never_recorded' })).toEqual({ state: 'never_recorded' })
    expect(dutyFilterOf({ zustand: 'kaputt' })).toEqual({})
  })

  it('hold nothing for an empty word, for a word the register does not know, and take digits as text', () => {
    expect(dutyFilterOf({ liegenschaft: '', farbe: 'rot' })).toEqual({})
    // The router reads digits as a number.
    expect(dutyFilterOf({ verantwortlich: 4711 })).toEqual({ responsible: '4711' })
  })
})

describe('the search of an address of the register of duties', () => {
  it('names each filter by its word, in the order the server reads them', () => {
    expect(
      Object.entries(
        dutySearch({
          responsible: 'none',
          dutyKind: 'probe.elevator_main_test',
          assetKind: 'probe.elevator',
          buildingId: 'b-1',
          propertyId: 'p-1',
          state: 'due',
        }),
      ),
    ).toEqual([
      ['zustand', 'due'],
      ['liegenschaft', 'p-1'],
      ['gebaeude', 'b-1'],
      ['art', 'probe.elevator'],
      ['pflichtart', 'probe.elevator_main_test'],
      ['verantwortlich', 'none'],
    ])
    expect(dutySearch({})).toEqual({})
  })

  it('is read back as the filter it was written from', () => {
    const filter = { state: 'ended', buildingId: 'b-1', responsible: 'u-roth' } as const

    expect(dutyFilterOf(dutySearch(filter))).toEqual(filter)
  })
})

describe('what the server is asked for a page of the register of duties with', () => {
  it('is the filters in the order the server knows them, then where the page begins and how many it holds', () => {
    expect(
      dutyRegisterRequest(
        { responsible: 'u-roth', assetKind: 'probe.elevator', state: 'overdue', propertyId: 'p-1' },
        50,
      ),
    ).toBe(
      '/duties/register?state=overdue&propertyId=p-1&assetKind=probe.elevator&responsible=u-roth&offset=50&limit=50',
    )
    expect(dutyRegisterRequest({}, 0)).toBe('/duties/register?offset=0&limit=50')
    expect(dutyRegisterRequest({ dutyKind: 'probe.elevator_main_test' }, 0, 1)).toBe(
      '/duties/register?dutyKind=probe.elevator_main_test&offset=0&limit=1',
    )
  })
})

describe('where the duties live in the office', () => {
  it('is the register, and the page of a duty under it by its id', () => {
    expect(dutyRegisterPlace).toEqual({ to: '/pflichten', label: 'Pflichtenverzeichnis' })
    expect(dutyPlaces.duty('d-1')).toBe('/pflichten/d-1')
  })
})
