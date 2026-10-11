import { describe, expect, it } from 'vitest'

import { asTableAddress } from './table-address.js'

describe('the address a list is read at as a table (#236)', () => {
  it('is the address of the list with the table behind its path, and no page', () => {
    expect(asTableAddress('/activities?state=done&search=aufzug&offset=50&limit=50')).toBe(
      '/activities/table?state=done&search=aufzug',
    )
    expect(asTableAddress('/duties/register?responsible=u-1&offset=0&limit=50')).toBe(
      '/duties/register/table?responsible=u-1',
    )
  })

  it('carries no question mark for a list that is narrowed by nothing', () => {
    expect(asTableAddress('/defects?offset=0&limit=50')).toBe('/defects/table')
    expect(asTableAddress('/work-orders')).toBe('/work-orders/table')
  })
})
