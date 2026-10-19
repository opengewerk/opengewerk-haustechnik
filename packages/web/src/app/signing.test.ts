import { type CatalogueBundle, type PackagedForm } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { catalogueKeep } from '../sync/catalogue.js'
import type { SyncClient } from '../sync/client.js'
import { pageOnDevice } from './signing.js'
import { acceptedReview, testCatalogue } from './test-catalogue.js'

/**
 * The page of an activity as the device signs it (#350): with the
 * catalogue it holds, a form with a group over the circuits names the
 * circuits of the asset of the activity, as the server's page does.
 */

const measured: PackagedForm = {
  title: 'Messen je Stromkreis',
  sections: [
    {
      key: 'measurements',
      title: 'Messen',
      fields: [
        {
          kind: 'group',
          key: 'circuits',
          label: 'Messen je Stromkreis',
          repeat: 'circuits',
          fields: [{ kind: 'check_point', key: 'circuit_ok', label: 'Stromkreis in Ordnung' }],
        },
      ],
    },
  ],
}

const withCircuits: CatalogueBundle = {
  ...testCatalogue,
  packages: testCatalogue.packages.map((pack, index) =>
    index === 0
      ? {
          ...pack,
          forms: [
            ...pack.forms,
            {
              key: 'probe.circuit_test',
              version: 1,
              validFrom: '2018-03-01',
              definition: measured,
              review: acceptedReview,
            },
          ],
        }
      : pack,
  ),
}

const held: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
  activities: [
    {
      id: 'ac-1',
      kind: 'inspection',
      title: 'Prüfung der elektrischen Anlage',
      performedOn: '2026-10-19',
      propertyId: 'pr-1',
      assetId: 'as-1',
      formKey: 'probe.circuit_test',
      formVersion: 1,
      collectiveKind: null,
      deletedAt: null,
    },
  ],
  distribution_boards: [
    {
      id: 'b-1',
      assetId: 'as-1',
      kind: 'main_distribution',
      designation: 'HV 1',
      position: 0,
      deletedAt: null,
    },
  ],
  circuits: [
    {
      id: 'c-1',
      distributionBoardId: 'b-1',
      boardSectionId: null,
      designation: 'F1',
      consumer: 'Licht',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 10_000,
      ratedResidualCurrentMilli: 30,
      position: 1,
      deletedAt: null,
    },
  ],
}

/** A device that holds the records above, and the catalogue or none. */
function device(catalogue: CatalogueBundle | null): SyncClient {
  return {
    list: (entity: string) => held[entity] ?? [],
    kept: (key: string) =>
      key === catalogueKeep && catalogue !== null ? JSON.stringify(catalogue) : null,
  } as unknown as SyncClient
}

describe('the page of an activity on the device (#350)', () => {
  it('names the circuits of the asset where the catalogue it holds says the form measures them', () => {
    expect(pageOnDevice(device(withCircuits), 'ac-1')?.circuits).toEqual([
      {
        id: 'c-1',
        designation: 'F1',
        consumer: 'Licht',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 10_000,
        ratedResidualCurrentMilli: 30,
        board: 'HV 1',
        place: 0,
      },
    ])
  })

  it('names none without a catalogue', () => {
    expect(pageOnDevice(device(null), 'ac-1')?.circuits).toBeUndefined()
  })
})
