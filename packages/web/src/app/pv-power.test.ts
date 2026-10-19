import { systemPeakText } from '@opengewerk/platform-web/electrical'
import { describe, expect, it } from 'vitest'

import { holdsInverters, installationPeakText } from './pv-power.js'

/**
 * The power of a PV installation as the page of an asset says it without the
 * building block of the foundation (#461): the same words as
 * `systemPeakText`, which the file of an installation in the trades
 * application says, for every mix of modules with and without a figure.
 */
describe('the power of a PV installation', () => {
  it('says what the foundation says, for every mix of modules', () => {
    const module = (ratedPowerW: number | null, id: number) => ({
      id: `m-${String(id)}`,
      ratedPowerW,
    })

    for (const modules of [
      [],
      [module(null, 1)],
      [module(400, 1)],
      Array.from({ length: 24 }, (_, index) => module(400, index)),
      [module(400, 1), module(415, 2), module(null, 3)],
      [module(2000, 1), module(1, 2)],
    ]) {
      expect(installationPeakText(modules)).toBe(systemPeakText(modules))
    }

    expect(installationPeakText(Array.from({ length: 24 }, (_, index) => module(400, index)))).toBe(
      '9,60 kWp aus 24 Modulen',
    )
  })

  it('belongs to a PV installation and to no other kind of asset', () => {
    expect(holdsInverters('elektro.photovoltaic_installation')).toBe(true)
    expect(holdsInverters('elektro.low_voltage_installation')).toBe(false)
    expect(holdsInverters(null)).toBe(false)
  })
})
