import { catalogueOf } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { shutDownOn } from './shut-down.js'
import { testCatalogue } from './test-catalogue.js'

/**
 * The defects a device holds that put an asset out of service (#345): open,
 * at an asset, of a class that makes an asset unsafe, by the asset, the one
 * found first first.
 */

const catalogue = catalogueOf(testCatalogue)

const defect = (id: string, further: Readonly<Record<string, unknown>> = {}) => ({
  id,
  assetId: 'a-lift',
  description: id,
  defectClass: 'probe.severe',
  status: 'found',
  foundOn: '2026-10-10',
  ...further,
})

describe('the assets a defect puts out of service, on a device', () => {
  it('are those with an open defect of an unsafe class, each with its defects, the one found first first', () => {
    const later = defect('later', { foundOn: '2026-10-12', status: 'ordered' })
    const first = defect('first', { foundOn: '2026-10-01' })
    const by = shutDownOn(
      [
        later,
        defect('slight', { defectClass: 'probe.slight' }),
        defect('unclassed', { defectClass: null }),
        defect('remedied', { assetId: 'a-pump', status: 'remedied' }),
        defect('verified', { assetId: 'a-pump', status: 'verified' }),
        defect('at-a-room', { assetId: null, roomId: 'r-boiler' }),
        first,
      ],
      catalogue,
    )

    expect([...by.keys()]).toEqual(['a-lift'])
    expect(by.get('a-lift')?.map((each) => each['id'])).toEqual(['first', 'later'])
  })

  it('are none on a device without a catalogue, which cannot say which class is unsafe', () => {
    expect(shutDownOn([defect('first')], null).size).toBe(0)
  })
})
