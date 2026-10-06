import type { AssetDetails, RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../app/test-catalogue.js'
import { memberIn } from '../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  untilTheRightsAreKnown,
} from './test-office.js'

/**
 * The card "Dokumente" at an asset, a room and a property in the office (#97,
 * 4.10 of the concept): each shows the documents that hang on that record and
 * on nothing else, the one changed last first, and files a new one at it. A
 * document opens on the screen "Dokumente".
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const ground = { id: 'f-ground', ...place, buildingId: house.id, name: 'Erdgeschoss', level: 0 }
const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
const store = { ...boilerRoom, id: 'r-store', number: 'E.2', name: 'Lager', use: null }
const lift = {
  id: 'a-lift',
  ...place,
  buildingId: house.id,
  roomId: boilerRoom.id,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00012',
  name: 'Aufzug Schulhaus',
}

const nowhere = { buildingId: null, roomId: null, assetId: null, activityId: null }
const document = (id: string, title: string, home: Readonly<Record<string, string>>) => ({
  id,
  ...place,
  ...nowhere,
  ...home,
  title,
  kind: null,
})

const manual = document('d-manual', 'Betriebsanleitung BA 630', { assetId: lift.id })
const plate = document('d-plate', 'Typenschild', { assetId: lift.id })
const plan = document('d-plan', 'Schaltplan Heizraum', { roomId: boilerRoom.id })
const inventory = document('d-inventory', 'Lagerliste', { roomId: store.id })
const concept = document('d-concept', 'Brandschutzkonzept Schulzentrum', {})
const handover = document('d-handover', 'Revisionsunterlagen Heizung', { buildingId: house.id })

const versionId = (order: number) => `00000000-0000-7000-8000-0000000000${String(order)}`
const version = (order: number, attachmentId: string, fileName: string, day: string) => ({
  id: versionId(order),
  attachmentId,
  sha256: String(order).padEnd(64, 'a'),
  fileName,
  mediaType: 'application/pdf',
  sizeBytes: 820_000,
  previewSha256: null,
  createdBy: 'u-kraemer',
  createdAt: `${day}T09:00:00.000Z`,
})

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
  'activities',
  'attachments',
  'attachment_versions',
] as const

let server: TestServer

async function mount(
  at: string,
  role: RoleKey = 'technician',
  lacking: readonly string[] = [],
  further: Readonly<Record<string, unknown>> = {},
) {
  const member = memberIn(role)

  signedInOffice(role, [sued], {
    '/auth/tenants': [
      { ...member, rights: member.rights.filter((right) => !lacking.includes(right)) },
    ],
    ...servingCatalogue(),
    ...further,
  })

  const mounted = await mountOffice(at, server, everything)

  await untilTheRightsAreKnown()

  return mounted
}

function card(): HTMLElement {
  return screen.getByRole('region', { name: 'Dokumente' })
}

/** The documents of the card, each with where its name leads and the line under it. */
function listed(): string[] {
  return within(card())
    .getAllByRole('listitem')
    .map((item) => {
      const link = within(item).getByRole('link')

      return `${link.textContent} > ${link.getAttribute('href') ?? ''} | ${
        item.querySelector('div')?.textContent ?? ''
      }`
    })
}

/** What the server was sent for a kind of record, as the fields of each new one. */
function created(entity: string) {
  return server
    .operations()
    .filter((operation) => operation.kind === 'create' && operation.entity === entity)
    .map((operation) =>
      Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    )
}

const scan = () =>
  new File(['%PDF-1.7 Wartungsvertrag'], 'Wartungsvertrag.pdf', { type: 'application/pdf' })

/** Files the scan through the dialog of the card, and waits until both records are sent. */
async function fileHere(client: { synchronise: () => Promise<unknown> }) {
  fireEvent.click(within(card()).getByRole('button', { name: 'Hochladen' }))

  const dialog = within(await screen.findByRole('dialog', { name: 'Dokument hochladen' }))

  fireEvent.change(dialog.getByLabelText('Datei wählen'), { target: { files: [scan()] } })
  await waitFor(() => {
    expect(dialog.getByRole<HTMLInputElement>('textbox', { name: /Bezeichnung/ }).value).toBe(
      'Wartungsvertrag',
    )
  })

  const said = dialog.getByText(/^Hängt an:/).textContent

  fireEvent.click(dialog.getByRole('button', { name: 'Hochladen' }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  await client.synchronise()

  return said
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('floors', ground)

  for (const room of [boilerRoom, store]) {
    server.put('rooms', room)
  }

  server.put('assets', lift)

  for (const each of [manual, plate, plan, inventory, concept, handover]) {
    server.put('attachments', each)
  }

  for (const each of [
    version(11, manual.id, 'betriebsanleitung-2012.pdf', '2026-03-14'),
    version(19, manual.id, 'betriebsanleitung-2024.pdf', '2026-09-12'),
    version(15, plate.id, 'typenschild.pdf', '2026-08-20'),
    version(12, plan.id, 'schaltplan-heizraum.pdf', '2026-09-02'),
    version(13, inventory.id, 'lagerliste.pdf', '2026-09-03'),
    version(14, concept.id, 'brandschutzkonzept-2019.pdf', '2026-03-14'),
    version(16, handover.id, 'revision-heizung.pdf', '2026-01-12'),
  ]) {
    server.put('attachment_versions', each)
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the documents of a room', () => {
  const at = `/raeume/${boilerRoom.id}`

  it('are those that hang on this room and on no other record, each leading to its versions', async () => {
    await mount(at)

    expect(listed()).toEqual([
      'Schaltplan Heizraum > /dokumente/d-plan | schaltplan-heizraum.pdf, 820 kB, 02.09.2026',
    ])
  })

  it('takes a new one at the room, on its property, and says where before it is filed', async () => {
    const { client } = await mount(at)

    expect(await fileHere(client)).toBe(
      'Hängt an: Raum E.14 Heizraum. Ein Dokument bleibt, wo es abgelegt wurde.',
    )
    expect(created('attachments')).toEqual([
      { title: 'Wartungsvertrag', propertyId: school.id, roomId: boilerRoom.id },
    ])
    expect(created('attachment_versions')).toMatchObject([{ fileName: 'Wartungsvertrag.pdf' }])
    // The one filed last stands first.
    expect(listed().map((line) => line.split(' > ')[0])).toEqual([
      'Wartungsvertrag',
      'Schaltplan Heizraum',
    ])
  })

  it('says so of a room nothing is filed at', async () => {
    server.put('rooms', { ...store, id: 'r-empty', number: 'E.3', name: 'Abstellraum' })
    await mount('/raeume/r-empty')

    expect(within(card()).getByText('Hier ist noch kein Dokument abgelegt.')).toBeTruthy()
  })

  it('offers no button to somebody who may not file documents', async () => {
    await mount(at, 'technician', ['document.record'])

    expect(listed()).toHaveLength(1)
    expect(within(card()).queryByRole('button', { name: 'Hochladen' })).toBeNull()
  })

  it('is not there for somebody who may not look at documents', async () => {
    await mount(at, 'technician', ['document.read'])
    await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })

    expect(screen.queryByRole('region', { name: 'Dokumente' })).toBeNull()
  })
})

describe('the documents of a property', () => {
  const at = `/liegenschaften/${school.id}`

  it('are those of the property itself, and none of a building, a room or an asset on it', async () => {
    await mount(at)

    expect(listed()).toEqual([
      'Brandschutzkonzept Schulzentrum > /dokumente/d-concept | brandschutzkonzept-2019.pdf, 820 kB, 14.03.2026',
    ])
  })

  it('takes a new one at the property and names no record on it', async () => {
    const { client } = await mount(at)

    expect(await fileHere(client)).toBe(
      'Hängt an: Liegenschaft Schulzentrum Am Lindenhain. Ein Dokument bleibt, wo es abgelegt wurde.',
    )
    expect(created('attachments')).toEqual([{ title: 'Wartungsvertrag', propertyId: school.id }])
  })
})

describe('the documents of an asset', () => {
  const at = `/anlagen/${lift.id}`
  const file = {
    ...lift,
    mark: null,
    manufacturer: null,
    model: null,
    serialNumber: null,
    yearBuilt: null,
    commissionedOn: null,
    warrantyEndsOn: null,
    values: {},
    meterNumber: null,
    meterUnit: null,
    lifecycle: [],
    lifecycleState: null,
    condition: 'no_duties',
    until: null,
    supplies: [],
    components: [],
    parent: null,
  } as unknown as AssetDetails
  const answers = { [`/assets/${lift.id}`]: file, [`/assets/${lift.id}/duties`]: [] }

  it('stand in its file, the one changed last first, with the version it has reached', async () => {
    await mount(at, 'technician', [], answers)
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(listed()).toEqual([
      'Betriebsanleitung BA 630 > /dokumente/d-manual | betriebsanleitung-2024.pdf, 820 kB, Fassung 2, 12.09.2026',
      'Typenschild > /dokumente/d-plate | typenschild.pdf, 820 kB, 20.08.2026',
    ])
  })

  it('takes a new one at the asset, on its property', async () => {
    const { client } = await mount(at, 'technician', [], answers)

    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(await fileHere(client)).toBe(
      'Hängt an: AN-00012 Aufzug Schulhaus. Ein Dokument bleibt, wo es abgelegt wurde.',
    )
    expect(created('attachments')).toEqual([
      { title: 'Wartungsvertrag', propertyId: school.id, assetId: lift.id },
    ])
  })
})
