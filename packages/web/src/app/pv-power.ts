import { inverterAssetKind, type RecordState } from '@opengewerk/haustechnik-domain'
import { useRecords } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

/**
 * What the page of a PV installation says about its structure without the
 * structure itself (#461): whether an asset holds inverters, the power of the
 * installation from its modules, and where an inverter is opened. Apart from
 * `photovoltaic.ts`, which brings the whole building block `electrical` of
 * the foundation with it, so that the page of an asset on site asks this
 * without pulling that block into the entry on site (`scripts/budget.js`), as
 * `holds-boards.ts` does for the boards. For the same reason the power is
 * added up here and not with `peakPower` of the domain: that would put the
 * rules of the PV structure into the entry as well, 1.3 kB of 300.
 */

/** Whether an asset of this kind has inverters: only a PV installation has. */
export function holdsInverters(kind: string | null | undefined): boolean {
  return kind === inverterAssetKind
}

/** Where an inverter of a PV installation is opened, in the office; a string has its page on site. */
export const pvPlaces = {
  inverter: (assetId: string, inverterId: string) =>
    `/anlagen/${assetId}/wechselrichter/${inverterId}`,
  string: (assetId: string, inverterId: string, stringId: string) =>
    `/anlagen/${assetId}/wechselrichter/${inverterId}/strings/${stringId}`,
} as const

const kilowattsPeak = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * "9,60 kWp aus 24 Modulen", and how many have no figure, or null while no
 * module has one: the words of `systemPeakText` of the foundation, which a
 * test holds equal to these.
 */
export function installationPeakText(
  modules: readonly { readonly ratedPowerW?: unknown }[],
): string | null {
  let watts = 0
  let known = 0

  for (const module of modules) {
    if (typeof module.ratedPowerW === 'number') {
      watts += module.ratedPowerW
      known += 1
    }
  }

  const unknown = modules.length - known

  if (known === 0) {
    return null
  }

  return `${kilowattsPeak.format(watts / 1000)} kWp aus ${String(known)} ${known === 1 ? 'Modul' : 'Modulen'}${
    unknown > 0 ? `, ${String(unknown)} ohne Angabe` : ''
  }`
}

/**
 * The modules of a PV installation this device holds, over its inverters and
 * their strings: a module whose inverter was removed a moment ago on this
 * device no longer counts, though the device learns that the module went
 * with it only at the next exchange.
 */
export function useInstallationModules(assetId: string | undefined): readonly RecordState[] {
  const inverters = useRecords('inverters')
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')

  return useMemo(() => {
    if (assetId === undefined) {
      return []
    }

    const own = new Set(
      inverters
        .filter((inverter) => inverter['assetId'] === assetId)
        .map((inverter) => String(inverter['id'])),
    )
    const ownStrings = new Set(
      strings
        .filter((pvString) => own.has(String(pvString['inverterId'])))
        .map((pvString) => String(pvString['id'])),
    )

    return modules.filter((module) => ownStrings.has(String(module['pvStringId'])))
  }, [assetId, inverters, strings, modules])
}

/** The power of a PV installation from its modules, or null while none has a figure. */
export function useInstallationPeak(assetId: string | undefined): string | null {
  const modules = useInstallationModules(assetId)

  return useMemo(() => installationPeakText(modules), [modules])
}
