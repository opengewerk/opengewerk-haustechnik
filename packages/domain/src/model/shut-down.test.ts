import { describe, expect, it } from 'vitest'

import {
  type DefectAtAsset,
  showsShutDown,
  shutDownBy,
  shutDownLabel,
  shutsDownItsAsset,
} from './asset-condition.js'
import type { CatalogueDefectClass } from './catalogue.js'
import { lifecycleStates } from './asset.js'
import { assetTableRow } from './office-table.js'

/** The three classes of the package Allgemein, of which "gefährlich" makes an asset unsafe. */
const classes: Readonly<Record<string, CatalogueDefectClass>> = Object.fromEntries(
  [
    ['allgemein.minor', 'gering', false],
    ['allgemein.significant', 'erheblich', false],
    ['allgemein.dangerous', 'gefährlich', true],
  ].map(([key, label, unsafe]) => [
    key,
    {
      defectClass: {
        key: key as string,
        label: label as string,
        unsafe: unsafe as boolean,
        source: null,
      },
      review: { checkedOn: '2026-10-01', accepted: null },
    },
  ]),
)
const catalogue = { defectClass: (key: string) => classes[key] ?? null }

const dangerous: DefectAtAsset = {
  assetId: 'asset-1' as DefectAtAsset['assetId'],
  status: 'found',
  defectClass: 'allgemein.dangerous',
}

describe('a defect that makes its asset unsafe (#345)', () => {
  it('puts its asset out of service while it is found or ordered, and a defect of another class does not', () => {
    expect(shutsDownItsAsset(dangerous, catalogue)).toBe(true)
    expect(shutsDownItsAsset({ ...dangerous, status: 'ordered' }, catalogue)).toBe(true)
    expect(
      shutsDownItsAsset({ ...dangerous, defectClass: 'allgemein.significant' }, catalogue),
    ).toBe(false)
    expect(shutsDownItsAsset({ ...dangerous, defectClass: 'allgemein.minor' }, catalogue)).toBe(
      false,
    )
  })

  it('ends once the defect is remedied, before it was checked again', () => {
    expect(shutsDownItsAsset({ ...dangerous, status: 'remedied' }, catalogue)).toBe(false)
    expect(shutsDownItsAsset({ ...dangerous, status: 'verified' }, catalogue)).toBe(false)
  })

  it('needs a class the catalogue knows, and an asset', () => {
    expect(shutsDownItsAsset({ ...dangerous, defectClass: null }, catalogue)).toBe(false)
    expect(shutsDownItsAsset({ ...dangerous, defectClass: 'elektro.gone' }, catalogue)).toBe(false)
    expect(shutsDownItsAsset({ ...dangerous, assetId: null }, catalogue)).toBe(false)
  })

  it('collects the defects that do by their asset, and leaves the others out', () => {
    const second = { ...dangerous, status: 'ordered' as const }
    const other = { ...dangerous, assetId: 'asset-2' as DefectAtAsset['assetId'] }
    const by = shutDownBy(
      [
        dangerous,
        { ...dangerous, defectClass: 'allgemein.minor' },
        second,
        { ...other, status: 'remedied' as const },
      ],
      catalogue,
    )

    expect([...by.keys()]).toEqual(['asset-1'])
    expect(by.get('asset-1')).toEqual([dangerous, second])
  })
})

describe('an asset out of service by a defect', () => {
  it('shows so over in service, no entry and out of service, and as what it is otherwise', () => {
    expect(lifecycleStates.filter((state) => showsShutDown(state, true))).toEqual([
      'in_service',
      'out_of_service',
    ])
    expect(showsShutDown(null, true)).toBe(true)
    expect(lifecycleStates.some((state) => showsShutDown(state, false))).toBe(false)
    expect(showsShutDown(null, false)).toBe(false)
  })

  it('says so in the table of the register, where the list shows it', () => {
    const entry = {
      id: 'asset-1',
      propertyId: 'property-1',
      buildingId: null,
      roomId: null,
      parentAssetId: null,
      kind: 'allgemein.heat_supply',
      number: 'AN-00057',
      name: 'Trinkwassererwärmer',
      condition: 'defect_open',
      until: null,
      lifecycleState: 'in_service',
      shutDown: true,
    } as unknown as Parameters<typeof assetTableRow>[0]

    expect(assetTableRow(entry, 'Anlage der Wärmeversorgung', 'Schulhaus').at(-1)).toBe(
      shutDownLabel,
    )
    expect(assetTableRow({ ...entry, shutDown: false }, 'x', 'y').at(-1)).toBe('In Betrieb')
  })
})
