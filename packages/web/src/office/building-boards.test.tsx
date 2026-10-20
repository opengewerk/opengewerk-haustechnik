import { boardAssetKind, type RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { servingCatalogue } from '../app/test-catalogue.js'
import { memberIn } from '../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
} from './test-office.js'

/**
 * The boards of a building (#495): the card "Verteiler" on the page of a
 * building lists every board that stands there, of whichever low-voltage
 * installation, and adds one under an installation that stands in the
 * building or supplies it; the form of a board offers the buildings of its
 * installation and the rooms of the one chosen.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const place = { propertyId: 'p-yard', areaId: nord.id }
const yard = {
  id: 'p-yard',
  areaId: nord.id,
  name: 'Werkhof Nord',
  street: 'Lagerweg 12',
  postalCode: '00002',
  city: 'Beispielstadt',
  federalState: 'DE-BW',
  note: null,
}
const hall = { id: 'b-hall', ...place, name: 'Halle 1', kinds: '["commercial"]', yearBuilt: 2009 }
const annex = { id: 'b-annex', ...place, name: 'Anbau', kinds: '["commercial"]', yearBuilt: 2015 }
const shed = { id: 'b-shed', ...place, name: 'Schuppen', kinds: '["commercial"]', yearBuilt: 1990 }
const ground = { id: 'f-annex', ...place, buildingId: annex.id, name: 'EG', level: 0 }
const technik = {
  id: 'r-technik',
  ...place,
  buildingId: annex.id,
  floorId: ground.id,
  number: 'E.03',
  name: 'Technik',
}
const installation = {
  id: 'a-install',
  ...place,
  buildingId: hall.id,
  roomId: null,
  parentAssetId: null,
  kind: boardAssetKind,
  number: 'AN-00012',
  name: 'Niederspannungsanlage Halle',
}
const second = { ...installation, id: 'a-second', number: 'AN-00013', name: 'Notstromanlage' }
const supplies = {
  id: 's-annex',
  ...place,
  assetId: installation.id,
  buildingId: annex.id,
  roomId: null,
}
const hv = {
  id: 'd-hv',
  ...place,
  assetId: installation.id,
  buildingId: hall.id,
  roomId: null,
  kind: 'main_distribution',
  designation: 'HV',
  location: null,
  position: 0,
}
const uv = {
  ...hv,
  id: 'd-uv',
  buildingId: annex.id,
  roomId: technik.id,
  kind: 'sub_distribution',
  designation: 'UV Anbau',
  location: 'neben der Tür',
  position: 1,
}

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
  'attachments',
  'distribution_boards',
  'board_sections',
  'circuits',
  'equipment',
  'tasks',
  'building_closures',
  'defects',
] as const

class Server extends TestServer {
  constructor(rows: Readonly<Record<string, readonly object[]>>) {
    super()

    for (const [entity, list] of Object.entries(rows)) {
      for (const row of list) {
        this.put(entity, row)
      }
    }
  }

  queued() {
    return this.operations().map((operation) => ({
      entity: operation.entity,
      kind: operation.kind,
      values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
  }
}

let server: Server

const standing = {
  properties: [yard],
  buildings: [hall, annex, shed],
  floors: [ground],
  rooms: [technik],
  assets: [installation],
  asset_supplies: [supplies],
  distribution_boards: [hv, uv],
}

async function mount(at: string, role: RoleKey = 'technician') {
  signedInOffice(role, [nord], {
    '/auth/tenants': [memberIn(role)],
    ...servingCatalogue(),
    [`/buildings/${annex.id}/to-do`]: { overdue: 0, due: 0, defects: 0, faults: 0 },
    [`/buildings/${hall.id}/to-do`]: { overdue: 0, due: 0, defects: 0, faults: 0 },
    [`/buildings/${shed.id}/to-do`]: { overdue: 0, due: 0, defects: 0, faults: 0 },
  })

  const mounted = await mountOffice(at, server, everything)

  await untilTheRightsAreKnown()

  return mounted
}

const theCard = 'Verteiler in diesem Gebäude mit ihrer Niederspannungsanlage und ihrem Raum'

function dialog(name: string) {
  return within(screen.getByRole('dialog', { name }))
}

beforeEach(() => {
  server = new Server(standing)
})

describe('the boards of a building', () => {
  it('lists the boards that stand there, with their installation and their room', async () => {
    await mount(`/gebaeude/${annex.id}`)

    await waitFor(() => {
      expect(rowsOf(theCard)).toEqual([
        [
          'UV AnbauUnterverteilung',
          'Niederspannungsanlage Halle',
          'E.03 Technikneben der Tür',
          '0',
        ],
      ])
    })
  })

  it('adds a board in this building under the one installation that supplies it', async () => {
    await mount(`/gebaeude/${annex.id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Verteiler aufnehmen' }))
    const form = dialog('Verteiler hinzufügen')

    expect((form.getByLabelText(/Gebäude/) as HTMLSelectElement).value).toBe(annex.id)
    // The buildings of the installation, its own first, and no other.
    expect(
      [...(form.getByLabelText(/Gebäude/) as HTMLSelectElement).options].map(
        (option) => option.text,
      ),
    ).toEqual(['Halle 1', 'Anbau'])
    expect(
      [...(form.getByLabelText(/Raum/) as HTMLSelectElement).options].map((option) => option.text),
    ).toEqual(['Kein Raum angegeben', 'E.03 Technik'])

    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'UV 2 Anbau' } })
    fireEvent.change(form.getByLabelText(/Raum/), { target: { value: technik.id } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })
    expect(server.queued()[0]).toMatchObject({
      entity: 'distribution_boards',
      kind: 'create',
      values: {
        assetId: installation.id,
        buildingId: annex.id,
        roomId: technik.id,
        designation: 'UV 2 Anbau',
      },
    })
  })

  it('asks under which installation where several supply the building', async () => {
    server = new Server({
      ...standing,
      assets: [installation, second],
      asset_supplies: [supplies, { ...supplies, id: 's-second', assetId: second.id }],
    })
    await mount(`/gebaeude/${annex.id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Verteiler aufnehmen' }))
    fireEvent.click(
      dialog('Unter welcher Niederspannungsanlage?').getByRole('button', {
        name: 'Notstromanlage',
      }),
    )

    const form = dialog('Verteiler hinzufügen')

    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'UV Notstrom' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })
    expect(server.queued()[0]?.values).toMatchObject({
      assetId: second.id,
      buildingId: annex.id,
    })
    // No room named, none sent.
    expect(server.queued()[0]?.values['roomId'] ?? null).toBeNull()
  })

  it('stays away from a building no installation stands in or supplies', async () => {
    await mount(`/gebaeude/${shed.id}`)

    await screen.findByRole('heading', { level: 1, name: 'Schuppen' })

    expect(screen.queryByRole('button', { name: 'Verteiler aufnehmen' })).toBeNull()
    expect(screen.queryByText('Noch kein Verteiler in diesem Gebäude.')).toBeNull()
  })
})
