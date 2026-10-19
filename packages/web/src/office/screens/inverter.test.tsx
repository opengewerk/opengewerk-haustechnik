import { type AssetDetails, inverterAssetKind, type RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'

/**
 * The PV structure below a PV installation in the office (#461): the card
 * "Wechselrichter" in the file of the asset with the power of the
 * installation among its facts, the page of an inverter with its strings and
 * their modules, and the dialogs that add and change them through the outbox.
 * Whoever takes stock of assets adds, changes and moves; only removing asks
 * for the right to keep them.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

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
const place = { propertyId: yard.id, areaId: nord.id }
const hall = { id: 'b-hall', ...place, name: 'Halle 1', kinds: '["commercial"]', yearBuilt: 2009 }
const installation = {
  id: 'a-pv',
  ...place,
  buildingId: hall.id,
  roomId: null,
  parentAssetId: null,
  kind: inverterAssetKind,
  number: 'AN-00014',
  name: 'PV-Anlage Dach Halle 1',
}
const lift = { ...installation, id: 'a-lift', kind: 'probe.elevator', name: 'Aufzug Halle' }
// A second installation on the roof, whose modules count for it and not for the first.
const carport = { ...installation, id: 'a-carport', number: 'AN-00015', name: 'PV-Anlage Carport' }

const onAsset = { ...place, assetId: installation.id }
const wr1 = {
  id: 'i-wr1',
  ...onAsset,
  designation: 'WR 1',
  location: 'E.02 Lager, an der Nordwand',
  manufacturer: 'Beispielwandler',
  model: 'BW 10.0',
  serialNumber: 'BW10-2305-0417',
  ratedPowerW: 10_000,
  mppInputs: 2,
  position: 0,
}
const wr2 = {
  ...wr1,
  id: 'i-wr2',
  designation: 'WR 2',
  location: null,
  manufacturer: null,
  model: null,
  serialNumber: null,
  ratedPowerW: null,
  mppInputs: null,
  position: 1,
}
const string = (id: string, designation: string, input: number) => ({
  id,
  ...onAsset,
  inverterId: wr1.id,
  designation,
  mppInput: input,
  azimuthDeg: null,
  tiltDeg: null,
  position: input,
})
// Put in out of their order, which the page does not follow.
const s2 = string('st-2', 'String 2', 2)
const s1 = string('st-1', 'String 1', 1)
const module = (id: string, on: string, position: number, serialNumber: string | null) => ({
  id,
  ...onAsset,
  pvStringId: on,
  manufacturer: 'Beispielsolar',
  model: 'BS 400 M',
  serialNumber,
  ratedPowerW: 400,
  position,
})
const m2 = module('m-2', s1.id, 2, 'BS4-2306-1102')
const m1 = module('m-1', s1.id, 1, 'BS4-2306-1101')
const m3 = module('m-3', s2.id, 1, null)
const elsewhere = {
  inverter: { ...wr2, id: 'i-carport', assetId: carport.id, designation: 'WR Carport' },
  string: { ...string('st-carport', 'String C', 1), assetId: carport.id, inverterId: 'i-carport' },
  module: { ...module('m-carport', 'st-carport', 1, 'BS4-9999'), assetId: carport.id },
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
  'inverters',
  'pv_strings',
  'pv_modules',
] as const

/** A server that holds the hall with its PV installation and the structure below it. */
class Server extends TestServer {
  constructor() {
    super()

    for (const [entity, rows] of Object.entries({
      properties: [yard],
      buildings: [hall],
      assets: [installation, lift, carport],
      inverters: [wr2, wr1, elsewhere.inverter],
      pv_strings: [s2, s1, elsewhere.string],
      pv_modules: [m2, m1, m3, elsewhere.module],
    })) {
      for (const row of rows) {
        this.put(entity, row)
      }
    }
  }

  /** What went out through the outbox, as entity, kind, record and the fields with their new values. */
  queued() {
    return this.operations().map((operation) => ({
      entity: operation.entity,
      kind: operation.kind,
      id: operation.recordId,
      values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
  }
}

let server: Server

function file(further: Readonly<Record<string, unknown>> = {}): AssetDetails {
  return {
    ...installation,
    mark: null,
    manufacturer: null,
    model: null,
    serialNumber: null,
    yearBuilt: null,
    commissionedOn: '2023-06-12',
    warrantyEndsOn: null,
    values: {},
    meterNumber: null,
    meterUnit: null,
    lifecycle: [],
    lifecycleState: 'in_service',
    condition: 'no_duties',
    until: null,
    supplies: [],
    components: [],
    parent: null,
    distinctFromAssets: [],
    distinctFromElsewhere: 0,
    replacesAssetId: null,
    replaces: null,
    replacedBy: null,
    shutDown: false,
    shutDownBy: null,
    ...further,
  } as unknown as AssetDetails
}

const theFile = (asset: AssetDetails = file()) => ({
  [`/assets/${asset.id}`]: asset,
  [`/assets/${asset.id}/duties`]: [],
  [`/assets/${asset.id}/evidence`]: [],
})

/** Somebody in a role, without the rights named, at an address of the office. */
async function mount(
  at: string,
  role: RoleKey = 'technician',
  lacking: readonly string[] = [],
  further: Readonly<Record<string, unknown>> = {},
) {
  const member = memberIn(role)

  signedInOffice(role, [nord], {
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

const theCard = 'Wechselrichter dieser Anlage mit Ort, Zahl der Strings und Leistung der Module'
const inverterAt = `/anlagen/${installation.id}/wechselrichter/${wr1.id}`

/** The strings of the page of an inverter, by name, each with the serial numbers of its modules. */
function strings(): [string, string[]][] {
  const list = screen.getByRole('region', { name: 'Strings und Module' })

  return within(list)
    .getAllByRole('group')
    .map((group) => [
      group.getAttribute('aria-label') ?? '',
      within(group)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[3]?.textContent ?? ''),
    ])
}

/** The dialog over the page, by its heading. */
function dialog(name: string) {
  return within(screen.getByRole('dialog', { name }))
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new Server()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the inverters in the file of a PV installation', () => {
  it('stand under the evidence in their order, with what each is, where it hangs, its strings and its power', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', [], theFile())

    await waitFor(() => {
      expect(rowsOf(theCard)).toEqual([
        [
          'WR 1Beispielwandler BW 10.0, 10,0 kW',
          'E.02 Lager, an der Nordwand',
          '2',
          '1,20 kWp3 Module',
        ],
        ['WR 2', '', '0', 'keine Module'],
      ])
    })
    expect(screen.getByRole('link', { name: 'WR 1' }).getAttribute('href')).toBe(inverterAt)
    expect(
      screen.getByText('Die Leistung der Anlage zählt die Module aller Wechselrichter zusammen.'),
    ).toBeTruthy()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)

    expect(headings.indexOf('Wechselrichter')).toBe(headings.indexOf('Nachweise') + 1)
  })

  it('give the power of the installation among its facts, from its modules', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', [], theFile())
    const facts = within(await screen.findByRole('region', { name: 'Stammdaten' }))

    await waitFor(() => {
      expect(facts.getByText('1,20 kWp aus 3 Modulen')).toBeTruthy()
    })
  })

  it('stand nowhere in the file of another kind of asset', async () => {
    await mount(`/anlagen/${lift.id}`, 'technician', [], theFile(file({ ...lift })))
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Halle' })
    await screen.findByText('Stammdaten')

    expect(screen.queryByRole('region', { name: 'Wechselrichter' })).toBeNull()
    expect(screen.queryByText(/kWp/)).toBeNull()
  })

  it('add an inverter at the end of the list, on the asset, with where it hangs and nothing of its place', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', [], theFile())

    fireEvent.click(await screen.findByRole('button', { name: 'Wechselrichter hinzufügen' }))
    const form = dialog('Wechselrichter hinzufügen')

    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'WR 3' } })
    fireEvent.change(form.getByLabelText('Ort'), { target: { value: 'Dach, am Aufgang' } })
    fireEvent.change(form.getByLabelText('Nennleistung in kW'), { target: { value: '8,5' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })

    const [made] = server.queued()

    expect(made).toMatchObject({
      entity: 'inverters',
      kind: 'create',
      values: {
        assetId: installation.id,
        designation: 'WR 3',
        location: 'Dach, am Aufgang',
        ratedPowerW: 8_500,
        position: 2,
      },
    })
    expect(made?.values).not.toHaveProperty('propertyId')
    expect(made?.values).not.toHaveProperty('areaId')
  })
})

describe('the page of an inverter', () => {
  it('lists its strings in their order, each with its modules in the order they were taken up', async () => {
    await mount(inverterAt)
    await screen.findByRole('heading', { level: 1, name: 'WR 1' })

    await waitFor(() => {
      expect(strings()).toEqual([
        ['String 1', ['BS4-2306-1101', 'BS4-2306-1102']],
        ['String 2', ['Ohne Seriennummer']],
      ])
    })
    expect(
      screen.getByText('E.02 Lager, an der Nordwand · 2 Strings, 3 Module, 1,20 kWp'),
    ).toBeTruthy()
    expect(screen.getByText('MPP-Eingang 1 · 2 Module, zusammen 0,80 kWp')).toBeTruthy()
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Liegenschaften', 'Werkhof Nord', 'Halle 1', 'PV-Anlage Dach Halle 1'])

    const side = within(screen.getByRole('region', { name: 'Wechselrichter' }))

    expect(
      Object.fromEntries(
        side
          .getAllByRole('term')
          .map((term, index) => [
            term.textContent,
            side.getAllByRole('definition')[index]?.textContent,
          ]),
      ),
    ).toMatchObject({
      Hersteller: 'Beispielwandler',
      Modell: 'BW 10.0',
      Seriennummer: 'BW10-2305-0417',
      Nennleistung: '10,0 kW',
      'MPP-Eingänge': '2',
      Ort: 'E.02 Lager, an der Nordwand',
    })
  })

  it('adds a module at the end of its string, as the last one of it, with its own serial number', async () => {
    await mount(inverterAt)

    fireEvent.click(await screen.findByRole('button', { name: 'Modul hinzufügen in String 1' }))
    const form = dialog('Modul hinzufügen')

    expect((form.getByLabelText('Hersteller') as HTMLInputElement).value).toBe('Beispielsolar')
    expect((form.getByLabelText('Leistung in Wp') as HTMLInputElement).value).toBe('400')
    expect((form.getByLabelText('Seriennummer') as HTMLInputElement).value).toBe('')
    fireEvent.change(form.getByLabelText('Seriennummer'), { target: { value: 'BS4-2306-1103' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })

    const [made] = server.queued()

    expect(made).toMatchObject({
      entity: 'pv_modules',
      kind: 'create',
      values: {
        pvStringId: s1.id,
        manufacturer: 'Beispielsolar',
        model: 'BS 400 M',
        serialNumber: 'BS4-2306-1103',
        ratedPowerW: 400,
        position: 3,
      },
    })

    for (const field of ['assetId', 'propertyId', 'areaId']) {
      expect(made?.values).not.toHaveProperty(field)
    }
  })

  it('says what is wrong with the power of a module, and queues nothing', async () => {
    await mount(inverterAt)

    fireEvent.click(await screen.findByRole('button', { name: 'Modul hinzufügen in String 2' }))
    const form = dialog('Modul hinzufügen')

    fireEvent.change(form.getByLabelText('Leistung in Wp'), { target: { value: '2500' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    expect(
      await form.findByText('Die Leistung eines Moduls ist größer als 0 und höchstens 2000 Wp.'),
    ).toBeTruthy()
    expect(server.queued()).toEqual([])
  })

  it('adds a string at the end of the inverter, and moves a module by its handle within its string', async () => {
    await mount(inverterAt)

    fireEvent.click(await screen.findByRole('button', { name: 'String hinzufügen' }))
    const form = dialog('String hinzufügen')

    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'String 3' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })
    expect(server.queued()[0]).toMatchObject({
      entity: 'pv_strings',
      kind: 'create',
      values: { inverterId: wr1.id, designation: 'String 3', position: 3 },
    })

    const handle = await screen.findByRole('button', { name: 'Modul 2 in String 1 verschieben' })

    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: ' ' })

    // Numbered afresh, and only what changes its number is written: the
    // first module keeps its 1.
    await waitFor(() => {
      expect(server.queued()).toHaveLength(2)
    })
    expect(server.queued()[1]).toEqual({
      entity: 'pv_modules',
      kind: 'update',
      id: m2.id,
      values: { position: 0 },
    })
  })
})

describe('the rights at the PV structure', () => {
  it('offer nothing to add, change or move without the right to take stock of assets', async () => {
    await mount(inverterAt, 'technician', ['asset.record'])
    await screen.findByRole('heading', { level: 1, name: 'WR 1' })
    await waitFor(() => {
      expect(strings()).toHaveLength(2)
    })

    for (const name of [
      'Bearbeiten',
      'String hinzufügen',
      'String 1 bearbeiten',
      'Modul hinzufügen in String 1',
      'Modul 1 in String 1 bearbeiten',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    expect(screen.queryAllByRole('button', { name: /verschieben$/ })).toEqual([])
  })

  it('offer no inverter and no handle in the file without the right to take stock of assets', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', ['asset.record'], theFile())

    await waitFor(() => {
      expect(rowsOf(theCard)).toHaveLength(2)
    })
    expect(screen.queryByRole('button', { name: 'Wechselrichter hinzufügen' })).toBeNull()
    expect(screen.queryAllByRole('button', { name: /verschieben$/ })).toEqual([])
  })

  it('leave "Entfernen" out for whoever takes stock of assets and does not keep them', async () => {
    await mount(inverterAt, 'technician')

    fireEvent.click(await screen.findByRole('button', { name: 'Modul 1 in String 1 bearbeiten' }))
    const form = dialog('Modul 1 bearbeiten')

    expect(form.getByRole('button', { name: 'Speichern' })).toBeTruthy()
    expect(form.queryByRole('button', { name: 'Entfernen' })).toBeNull()

    fireEvent.click(form.getByRole('button', { name: 'Abbrechen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))

    expect(dialog('WR 1 bearbeiten').queryByRole('button', { name: 'Entfernen' })).toBeNull()
  })

  it('offer "Entfernen" to whoever keeps the assets, after a second question', async () => {
    const { router } = await mount(inverterAt, 'site_management')

    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    fireEvent.click(dialog('WR 1 bearbeiten').getByRole('button', { name: 'Entfernen' }))

    const question = within(screen.getByRole('alertdialog', { name: '„WR 1“ entfernen?' }))

    expect(question.getByText('Mit dem Wechselrichter gehen 2 Strings und 3 Module.')).toBeTruthy()
    expect(server.queued()).toEqual([])
    fireEvent.click(question.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(server.queued()).toEqual([
        { entity: 'inverters', kind: 'delete', id: wr1.id, values: {} },
      ])
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/anlagen/${installation.id}`)
    })
  })
})
