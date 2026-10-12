import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type CataloguePackage,
  catalogueOf,
  costGroupName,
  costGroupWords,
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

// With the version of the application and the day in Germany the build takes
// (build.ts), and not with fixed ones: whoever checks an entry again, accepts
// one or raises what the package asks of the application writes a later day
// or a higher version into the package, and that must not turn this test red.
const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

// The cost groups of the technical installations on the second level, by
// number: the application holds no list of them, and none of their headings.
const groups = Array.from({ length: 9 }, (_, index) => String(410 + index * 10))

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

    // Nine groups on the second level, 410 to 490: the level the register
    // and the picture of a building sort by.
    expect(kinds.map((entry) => entry.definition.costGroup).sort()).toEqual(groups)
    expect(kinds.every((entry) => entry.version === 1 && isGeneralKind(entry.key))).toBe(true)
  })

  it('gives each of these cost groups the name it goes by on a screen (#163)', () => {
    const { bundle } = loadCatalogue(new Map([...shipped, ...probe]), options)
    const kinds = catalogueOf(bundle as NonNullable<typeof bundle>).assetKinds(options.today)
    const labels = new Map(
      general().assetKinds.map((entry) => [entry.definition.costGroup, entry.definition.label]),
    )

    // The label of the general kind and of no kind beside it: the probe
    // package has an elevator in 461, which names neither 461 nor 460.
    expect(groups.map((group) => costGroupName(group, kinds))).toEqual(
      groups.map((group) => labels.get(group)),
    )
    expect(costGroupWords('460', kinds)).toBe(`KG 460 ${labels.get('460') ?? ''}`)
    expect(costGroupWords('461', kinds)).toBe('KG 461')
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
