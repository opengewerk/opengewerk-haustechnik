import { fileURLToPath } from 'node:url'

import {
  type CataloguePackage,
  catalogueOf,
  costGroupNames,
  dutyKindsNaming,
  generalPackage,
  isGeneralKind,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Allgemein as the repository holds it under pakete/, read the
// way the build reads it (opengewerk-haustechnik#61, sections 4.2, 4.6 and 5
// of the concept). The probe package stands beside it as the specialist
// package an asset is corrected to.
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))
const probe = readPackageFiles(fileURLToPath(new URL('../test/pakete/', import.meta.url)))
const options = { applicationVersion: '0.0.0', today: '2026-10-05' }

function general(): CataloguePackage {
  const { bundle, problems } = loadCatalogue(shipped, options)
  const found = bundle?.packages.find((entry) => entry.name === generalPackage)

  if (!found) {
    throw new Error(`Das Paket ${generalPackage} lädt nicht: ${problems.join(' ')}`)
  }

  return found
}

describe('the package Allgemein', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(general().title).toBe('Allgemein')
  })

  it('has exactly one general asset kind for every cost group of the technical installations', () => {
    const kinds = general().assetKinds
    const groups = Object.keys(costGroupNames)

    // Nine groups on the second level, 410 to 490: the level the register
    // and the picture of a building sort by.
    expect(groups).toHaveLength(9)
    expect(kinds.map((entry) => entry.definition.costGroup).sort()).toEqual(groups)
    expect(kinds.every((entry) => entry.version === 1 && isGeneralKind(entry.key))).toBe(true)
  })

  it('describes a general kind by its name and its cost group and by nothing else', () => {
    expect(
      general().assetKinds.map(({ definition }) => ({
        characteristics: definition.characteristics,
        fields: definition.fields,
        expectedDocuments: definition.expectedDocuments,
        meter: definition.meter,
      })),
    ).toEqual(
      general().assetKinds.map(() => ({
        characteristics: [],
        fields: [],
        expectedDocuments: [],
        meter: null,
      })),
    )
    // Each under a name of its own: two kinds called the same could not be told apart.
    expect(new Set(general().assetKinds.map((entry) => entry.definition.label)).size).toBe(9)
  })

  it('brings no duty kind, and no duty kind of a package beside it proposes one for a general kind', () => {
    const { bundle, problems } = loadCatalogue(new Map([...shipped, ...probe]), options)

    expect(problems).toEqual([])
    expect(general().dutyKinds).toEqual([])

    const catalogue = catalogueOf(bundle as NonNullable<typeof bundle>)

    // The probe package has a duty kind, so the question below is asked of
    // a catalogue that proposes something for somebody.
    expect(dutyKindsNaming(catalogue, 'probe.elevator', options.today)).toHaveLength(1)
    expect(
      general().assetKinds.flatMap((entry) => dutyKindsNaming(catalogue, entry.key, options.today)),
    ).toEqual([])
  })

  it('brings the three general defect classes, of which the last makes an asset unsafe', () => {
    expect(
      general().defectClasses.map(({ defectClass }) => [
        defectClass.key,
        defectClass.label,
        defectClass.unsafe,
      ]),
    ).toEqual([
      ['allgemein.minor', 'gering', false],
      ['allgemein.significant', 'erheblich', false],
      ['allgemein.dangerous', 'gefährlich', true],
    ])
  })
})
