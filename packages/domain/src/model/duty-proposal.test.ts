import { describe, expect, it } from 'vitest'

import {
  type AssetKind,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueFormat,
  catalogueOf,
  type CatalogueReview,
  type DutyKind,
  type DutyScope,
} from './catalogue.js'
import {
  batchAssetsProblem,
  conditionHolds,
  proposalBatch,
  type ProposalSubject,
  proposedKinds,
  scopeApplies,
} from './duty-proposal.js'

/**
 * The proposals of the catalogue (#102): a duty kind comes into question for
 * an asset of a kind it names, where its conditions hold, in a building of a
 * kind it names and in a state it names; a kind decided on is not proposed
 * again. The catalogue is the probe package (the main test of an elevator,
 * with the flag "Feuerwehraufzug"), beside it a kind made from it for one
 * kind of building in one state, and one with a threshold on the output of the drive.
 */

const review: CatalogueReview = { checkedOn: '2026-10-03', accepted: null }
const on = '2026-10-10'

const elevator: AssetKind = {
  label: 'Aufzugsanlage',
  costGroup: '461',
  characteristics: [
    { key: 'firefighters_lift', label: 'Feuerwehraufzug', kind: 'flag' },
    { key: 'output', label: 'Antriebsleistung', kind: 'number', unit: 'kilowatts' },
    {
      key: 'drive',
      label: 'Antrieb',
      kind: 'choice',
      options: [
        { value: 'rope', label: 'Seil' },
        { value: 'hydraulic', label: 'Hydraulik' },
      ],
    },
  ],
  fields: [],
  expectedDocuments: [],
  meter: null,
}

const mainTest: DutyKind = {
  label: 'Hauptprüfung der Aufzugsanlage',
  description: 'Die Aufzugsanlage wird wiederkehrend geprüft.',
  task: 'inspection',
  origin: 'state_law',
  bindingness: 'statute',
  source: 'Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
  interval: { kind: 'maximum', rule: 'probe.elevator_main_test_interval' },
  counting: 'betrsichv',
  qualification: { level: 'approved_body' },
  evidence: { kinds: ['report'] },
  retention: { kind: 'while_in_use' },
  scope: { assetKinds: ['probe.elevator'], conditions: [], buildingKinds: [], states: [] },
}

function like(key: string, scope: Partial<DutyScope>): CatalogueEntry<DutyKind> {
  return {
    key,
    version: 1,
    validFrom: '2015-06-01',
    definition: { ...mainTest, scope: { ...mainTest.scope, ...scope } },
    review,
  }
}

const bundle: CatalogueBundle = {
  format: catalogueFormat,
  sha256: 'a'.repeat(64),
  packages: [
    {
      name: 'probe',
      title: 'Probepaket',
      version: '1.0.0',
      minimumCore: '0.0.0',
      assetKinds: [
        {
          key: 'probe.elevator',
          version: 1,
          validFrom: '2015-06-01',
          definition: elevator,
          review,
        },
      ],
      dutyKinds: [
        like('probe.elevator_main_test', {}),
        like('probe.school_lift_bw', { buildingKinds: ['school', 'assembly'], states: ['DE-BW'] }),
        like('probe.strong_lift', {
          conditions: [{ characteristic: 'output', atLeast: 'probe.strong' }],
        }),
        like('probe.strong_lift_bw', {
          conditions: [{ characteristic: 'output', atLeast: 'probe.strong_bw' }],
        }),
      ],
      forms: [],
      roundTemplates: [],
      rules: [
        {
          record: {
            key: 'probe.elevator_main_test_interval',
            validFrom: '2015-06-01',
            validUntil: null,
            unit: 'months',
            value: 24,
            source: 'Anhang 2 Abschnitt 2 Nr. 4.1 Satz 4 BetrSichV',
            origin: 'state_law',
          },
          review,
        },
        {
          record: {
            key: 'probe.strong_bw',
            scope: 'DE-BW',
            validFrom: '2020-01-01',
            validUntil: null,
            unit: 'kilowatts',
            value: 15,
            source: 'Landesprobeverordnung, § 1',
            origin: 'state_law',
          },
          review,
        },
        {
          record: {
            key: 'probe.strong',
            validFrom: '2020-01-01',
            validUntil: null,
            unit: 'kilowatts',
            value: 15,
            source: 'Probenorm 1, Abschnitt 2',
            origin: 'private_standard',
          },
          review,
        },
      ],
      defectClasses: [],
    },
  ],
}

const catalogue = catalogueOf(bundle)

/** An elevator in a school in Baden-Württemberg, with nothing entered about it. */
const school: ProposalSubject = {
  assetKind: 'probe.elevator',
  values: {},
  buildingKinds: ['school'],
  federalState: 'DE-BW',
}

const keys = (subject: ProposalSubject, decided: readonly string[] = []) =>
  proposedKinds(catalogue, subject, on, new Set(decided)).map((entry) => entry.key)

describe('the proposals for an asset', () => {
  it('are the duty kinds whose scope takes it in, in the order of the catalogue', () => {
    expect(keys(school)).toEqual([
      'probe.elevator_main_test',
      'probe.school_lift_bw',
      'probe.strong_lift',
      'probe.strong_lift_bw',
    ])
  })

  it('leave out a kind for another kind of asset', () => {
    expect(keys({ ...school, assetKind: 'probe.water_meter' })).toEqual([])
  })

  it('leave out a kind for a building of another kind', () => {
    expect(keys({ ...school, buildingKinds: ['office'] })).not.toContain('probe.school_lift_bw')
    expect(keys({ ...school, buildingKinds: ['office'] })).toContain('probe.elevator_main_test')
  })

  it('take in a building of several kinds by any one of them', () => {
    expect(keys({ ...school, buildingKinds: ['office', 'assembly'] })).toContain(
      'probe.school_lift_bw',
    )
  })

  it('leave out a kind for another federal state', () => {
    expect(keys({ ...school, federalState: 'DE-BY' })).not.toContain('probe.school_lift_bw')
    expect(keys({ ...school, federalState: 'DE-BY' })).toContain('probe.elevator_main_test')
  })

  it('leave out a kind decided on already, confirmed or dismissed', () => {
    expect(
      keys(school, ['probe.elevator_main_test', 'probe.strong_lift', 'probe.strong_lift_bw']),
    ).toEqual(['probe.school_lift_bw'])
  })

  it('hold a threshold against the rule of the state of the property', () => {
    expect(keys({ ...school, values: { output: 14 } })).not.toContain('probe.strong_lift_bw')
    // In a state without the rule there is no threshold, and the kind is proposed.
    expect(keys({ ...school, federalState: 'DE-BY', values: { output: 14 } })).toContain(
      'probe.strong_lift_bw',
    )
  })

  it('hold a threshold against the value of its rule on the day', () => {
    expect(keys({ ...school, values: { output: 15 } })).toContain('probe.strong_lift')
    expect(keys({ ...school, values: { output: 14 } })).not.toContain('probe.strong_lift')
    // Before the rule begins there is no threshold, and the kind is proposed.
    expect(
      proposedKinds(catalogue, { ...school, values: { output: 1 } }, '2019-12-31', new Set()).map(
        (entry) => entry.key,
      ),
    ).toContain('probe.strong_lift')
  })
})

describe('a condition of a scope', () => {
  const holds = (
    condition: Parameters<typeof conditionHolds>[1],
    values: ProposalSubject['values'],
  ) => conditionHolds(catalogue, condition, values, on, 'DE-BW')

  it('holds a flag, a choice and a threshold from both sides', () => {
    expect(
      holds({ characteristic: 'firefighters_lift', is: true }, { firefighters_lift: true }),
    ).toBe(true)
    expect(
      holds({ characteristic: 'firefighters_lift', is: true }, { firefighters_lift: false }),
    ).toBe(false)
    expect(holds({ characteristic: 'drive', oneOf: ['rope'] }, { drive: 'rope' })).toBe(true)
    expect(holds({ characteristic: 'drive', oneOf: ['rope'] }, { drive: 'hydraulic' })).toBe(false)
    expect(holds({ characteristic: 'output', below: 'probe.strong' }, { output: 14 })).toBe(true)
    expect(holds({ characteristic: 'output', below: 'probe.strong' }, { output: 15 })).toBe(false)
  })

  it('counts as met while the characteristic is not entered: a proposal too many is dismissed', () => {
    expect(holds({ characteristic: 'firefighters_lift', is: true }, {})).toBe(true)
    expect(holds({ characteristic: 'drive', oneOf: ['rope'] }, {})).toBe(true)
    expect(holds({ characteristic: 'output', atLeast: 'probe.strong' }, {})).toBe(true)
  })
})

describe('the scope of a duty kind', () => {
  it('names the asset kind first: no condition makes up for another kind', () => {
    expect(
      scopeApplies(catalogue, { ...mainTest.scope, assetKinds: ['probe.pump'] }, school, on),
    ).toBe(false)
  })
})

describe('the assets of a batch', () => {
  it('are distinct ids, at least one and at most as many as a batch holds', () => {
    expect(batchAssetsProblem(['a', 'b'])).toBeNull()
    expect(batchAssetsProblem([])).not.toBeNull()
    expect(batchAssetsProblem('a')).not.toBeNull()
    expect(batchAssetsProblem(['a', ''])).not.toBeNull()
    expect(batchAssetsProblem(['a', 'b', 'a'])).toMatch(/zweimal/)
    expect(
      batchAssetsProblem(Array.from({ length: proposalBatch.most + 1 }, (_, n) => String(n))),
    ).not.toBeNull()
  })
})
