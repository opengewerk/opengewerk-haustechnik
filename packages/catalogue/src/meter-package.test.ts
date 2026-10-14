import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type CataloguePackage,
  catalogueOf,
  dutyKindsNaming,
  isGeneralKind,
  type KindChoice,
  meterMedia,
  suggestedKind,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Messstellen as the repository holds it under pakete/, read the
// way the build reads it (opengewerk-haustechnik#287, sections 4.9 and 5 of
// the concept): without it no instance could hold a meter, since a meter
// number belongs to an asset whose kind is a measuring point.
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))

// With the version of the application and the day in Germany the build takes,
// as in the test of the package Allgemein.
const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

function meters(): CataloguePackage {
  const { bundle, problems } = loadCatalogue(shipped, options)
  const found = bundle?.packages.find((entry) => entry.name === 'messstellen')

  if (!found) {
    throw new Error(`Das Paket messstellen lädt nicht: ${problems.join(' ')}`)
  }

  return found
}

describe('the package Messstellen', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(meters().title).toBe('Messstellen')
  })

  it('has one asset kind for every medium of section 4.9, each a measuring point in units that add up', () => {
    const byMedium = Object.fromEntries(
      meters().assetKinds.map(({ definition }) => [
        definition.meter?.medium,
        definition.meter?.units,
      ]),
    )

    // Electricity and heat in either kWh or MWh, which convert into each
    // other; water and gas in m³ only, since a gas meter knows no calorific value.
    expect(byMedium).toEqual({
      electricity: ['kilowatt_hours', 'megawatt_hours'],
      water: ['cubic_metres'],
      heat: ['kilowatt_hours', 'megawatt_hours'],
      district_heating: ['kilowatt_hours', 'megawatt_hours'],
      gas: ['cubic_metres'],
      cooling: ['kilowatt_hours', 'megawatt_hours'],
    })
    expect(Object.keys(byMedium).sort()).toEqual([...meterMedia].sort())
    expect(meters().assetKinds).toHaveLength(meterMedia.length)
  })

  it('stands beside the general kinds and not among them, so a list finds each by its word', () => {
    const { bundle } = loadCatalogue(shipped, options)
    const choices: KindChoice[] = catalogueOf(bundle as NonNullable<typeof bundle>)
      .assetKinds(options.today)
      .map(({ key, definition }) => ({
        key,
        label: definition.label,
        costGroup: definition.costGroup,
      }))
    const kinds = meters().assetKinds

    expect(kinds.filter((entry) => isGeneralKind(entry.key))).toEqual([])
    // A general kind would be offered for the cost group instead, and the
    // file of the asset would say its package is still missing.
    expect(
      kinds.map((entry) =>
        suggestedKind(
          { name: entry.definition.label, count: 1, costGroup: entry.definition.costGroup },
          choices,
        ),
      ),
    ).toEqual(kinds.map((entry) => entry.key))
  })

  it('brings no duty kind and no defect classes of its own', () => {
    const { bundle } = loadCatalogue(shipped, options)
    const catalogue = catalogueOf(bundle as NonNullable<typeof bundle>)

    expect(meters().dutyKinds).toEqual([])
    expect(meters().defectClasses).toEqual([])
    expect(
      meters().assetKinds.flatMap((entry) => dutyKindsNaming(catalogue, entry.key, options.today)),
    ).toEqual([])
  })
})
