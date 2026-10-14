import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type BuildingKind,
  type Catalogue,
  catalogueOf,
  type ProposalSubject,
  proposedKinds,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Landesrecht as the repository holds it under pakete/, read the
// way the build reads it (opengewerk-haustechnik#94, sections 2.9 and 5 of the
// concept). What is expected below is checked against the consolidated texts on
// landesrecht-bw.de of 14 October 2026: § 37 VStättVO, § 30 VkVO and § 16 GaVO
// of Baden-Württemberg, the three ordinances of the state that have technical
// installations inspected. Whoever changes one in the package changes it here,
// against the same text.
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))

// With the version of the application and the day in Germany the build takes,
// as in the test of the package Elektro.
const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

function stateLaw(): Catalogue {
  const { bundle, problems } = loadCatalogue(shipped, options)

  if (!bundle) {
    throw new Error(`Die Pakete laden nicht: ${problems.join(' ')}`)
  }

  return catalogueOf(bundle)
}

// The duty kinds of this package the catalogue proposes for an asset, the way
// the register of duties asks for them.
function proposed(
  assetKind: string,
  buildingKinds: readonly BuildingKind[],
  federalState: ProposalSubject['federalState'] = 'DE-BW',
): readonly string[] {
  return proposedKinds(
    stateLaw(),
    { assetKind, values: {}, buildingKinds, federalState },
    options.today,
    new Set(),
  )
    .map((entry) => entry.key)
    .filter((key) => key.startsWith('landesrecht.'))
}

// Every asset kind of the packages of phase 1 the three ordinances name, and
// one they do not (a fire door), so that a kind too many shows as well.
const assetKinds = [
  'brandschutz.smoke_extraction',
  'brandschutz.extinguishing_system',
  'brandschutz.wall_hydrant',
  'brandschutz.fire_alarm_system',
  'brandschutz.alarm_system',
  'brandschutz.fire_door',
  'elektro.safety_power_supply',
  'elektro.safety_lighting',
  'elektro.lightning_protection',
] as const

// For a building of one kind in Baden-Württemberg: the asset kinds the package
// proposes a duty kind for, each with the duty kinds.
function byAssetKind(kind: BuildingKind): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    assetKinds
      .map((assetKind) => [assetKind, proposed(assetKind, [kind])] as const)
      .filter(([, keys]) => keys.length > 0),
  )
}

describe('the package Landesrecht', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(stateLaw().packages.find((entry) => entry.name === 'landesrecht')?.title).toBe(
      'Landesrecht',
    )
  })

  it('has the installations of a place of assembly inspected as § 37 VStättVO names them, the lightning protection apart', () => {
    const assembly = ['landesrecht.bw_assembly_inspection']

    expect(byAssetKind('assembly')).toEqual({
      'brandschutz.smoke_extraction': assembly,
      'brandschutz.extinguishing_system': assembly,
      'brandschutz.wall_hydrant': assembly,
      'brandschutz.fire_alarm_system': assembly,
      'brandschutz.alarm_system': assembly,
      'elektro.safety_power_supply': assembly,
      'elektro.safety_lighting': assembly,
      'elektro.lightning_protection': ['landesrecht.bw_assembly_lightning_protection_inspection'],
    })
  })

  it('has the installations of a retail building inspected as § 30 VkVO names them', () => {
    const retail = ['landesrecht.bw_retail_inspection']

    expect(byAssetKind('retail')).toEqual({
      'brandschutz.smoke_extraction': retail,
      'brandschutz.extinguishing_system': retail,
      'brandschutz.fire_alarm_system': retail,
      'elektro.safety_power_supply': retail,
      'elektro.safety_lighting': retail,
    })
  })

  it('has the installations of a garage inspected as § 16 GaVO names them', () => {
    const garage = ['landesrecht.bw_garage_inspection']

    expect(byAssetKind('garage')).toEqual({
      'brandschutz.smoke_extraction': garage,
      'brandschutz.extinguishing_system': garage,
      'brandschutz.wall_hydrant': garage,
      'elektro.safety_power_supply': garage,
      'elektro.safety_lighting': garage,
    })
  })

  it('proposes nothing for a building in another state or of another kind', () => {
    for (const state of ['DE-BY', 'DE-HE', 'DE-RP'] as const) {
      for (const kind of ['assembly', 'retail', 'garage'] as const) {
        for (const assetKind of assetKinds) {
          expect(proposed(assetKind, [kind], state), `${assetKind} ${kind} ${state}`).toEqual([])
        }
      }
    }

    for (const kind of ['office', 'school', 'residential', 'commercial', 'other'] as const) {
      expect(byAssetKind(kind), kind).toEqual({})
    }
  })

  it('proposes the duties of a place of assembly for a school that has an assembly hall', () => {
    expect(proposed('elektro.safety_lighting', ['school', 'assembly'])).toEqual([
      'landesrecht.bw_assembly_inspection',
    ])
    expect(proposed('elektro.safety_lighting', ['assembly', 'retail', 'garage'])).toEqual([
      'landesrecht.bw_assembly_inspection',
      'landesrecht.bw_garage_inspection',
      'landesrecht.bw_retail_inspection',
    ])
  })

  it('takes every inspection from a recognised expert every three years at most, the lightning protection from a skilled person, with the reports kept five years', () => {
    const catalogue = stateLaw()
    const duties = catalogue
      .dutyKinds(options.today)
      .filter((entry) => entry.key.startsWith('landesrecht.'))

    expect(
      duties.map(({ key, definition }) => {
        const interval = catalogue.interval(definition, options.today, 'DE-BW')
        const retention = catalogue.retention(definition, options.today, 'DE-BW')

        return [
          key,
          definition.source,
          definition.origin,
          definition.task,
          definition.interval.kind,
          definition.counting,
          definition.qualification.level,
          interval === null ? null : [interval.record.value, interval.record.unit],
          interval?.record.source,
          retention?.kind === 'years'
            ? [retention.rule.record.value, retention.rule.record.source]
            : null,
        ]
      }),
    ).toEqual([
      [
        'landesrecht.bw_assembly_inspection',
        '§ 37 Abs. 1 Nr. 2 bis 6 VStättVO BW',
        'state_law',
        'inspection',
        'maximum',
        'from_performance',
        'certified_expert',
        [3, 'years'],
        '§ 37 Abs. 3 VStättVO BW',
        [5, '§ 37 Abs. 6 VStättVO BW'],
      ],
      [
        'landesrecht.bw_assembly_lightning_protection_inspection',
        '§ 37 Abs. 4 VStättVO BW',
        'state_law',
        'inspection',
        'maximum',
        'from_performance',
        'skilled_person',
        [3, 'years'],
        '§ 37 Abs. 3 VStättVO BW',
        [5, '§ 37 Abs. 6 VStättVO BW'],
      ],
      [
        'landesrecht.bw_garage_inspection',
        '§ 16 Abs. 1 GaVO BW',
        'state_law',
        'inspection',
        'maximum',
        'from_performance',
        'certified_expert',
        [3, 'years'],
        '§ 16 Abs. 1 Satz 2 GaVO BW',
        [5, '§ 16 Abs. 2 Nr. 4 GaVO BW'],
      ],
      [
        'landesrecht.bw_retail_inspection',
        '§ 30 Abs. 1 VkVO BW',
        'state_law',
        'inspection',
        'maximum',
        'from_performance',
        'certified_expert',
        [3, 'years'],
        '§ 30 Abs. 1 VkVO BW',
        [5, '§ 30 Abs. 2 Nr. 4 VkVO BW'],
      ],
    ])
  })

  it('has no interval outside Baden-Württemberg, and none for a garage before the ordinance of 2021', () => {
    const catalogue = stateLaw()
    const garage = catalogue
      .dutyKinds(options.today)
      .find((entry) => entry.key === 'landesrecht.bw_garage_inspection')

    if (!garage) {
      throw new Error('Das Paket hat keine Prüfung einer Garage.')
    }

    expect(catalogue.interval(garage.definition, options.today, 'DE-BY')).toBeNull()
    expect(
      catalogue.rule('landesrecht.garage_inspection_interval', '2021-01-31', 'DE-BW'),
    ).toBeNull()
    expect(
      catalogue.rule('landesrecht.garage_inspection_interval', '2021-02-01', 'DE-BW')?.record.value,
    ).toBe(3)
  })
})
