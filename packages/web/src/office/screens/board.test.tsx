import { type AssetDetails, boardAssetKind, type RoleKey } from '@opengewerk/haustechnik-domain'
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
 * The electrical structure below a low-voltage installation in the office
 * (#349): the card "Verteiler" in the file of the asset, the page of a board
 * with its sections and circuits and the circuit chosen with its equipment,
 * and the dialogs that add and change them through the outbox. Whoever takes
 * stock of assets adds, changes and moves; only removing asks for the right
 * to keep them. The chart is the server's, at the address of the asset.
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
  id: 'a-install',
  ...place,
  buildingId: hall.id,
  roomId: null,
  parentAssetId: null,
  kind: boardAssetKind,
  number: 'AN-00012',
  name: 'Elektrische Anlage Halle 1',
}
const lift = { ...installation, id: 'a-lift', kind: 'probe.elevator', name: 'Aufzug Halle' }

const onAsset = { ...place, assetId: installation.id }
const board = (id: string, designation: string, position: number, more: object = {}) => ({
  id,
  ...onAsset,
  buildingId: hall.id,
  roomId: null,
  kind: 'sub_distribution',
  designation,
  location: null,
  position,
  ...more,
})
// Put in out of their order, which the card does not follow.
const uv2 = board('b-uv2', 'UV 2', 2, { location: 'E.02 Lager' })
const hv = board('b-hv', 'HV', 0, { kind: 'main_distribution', location: 'Halle, neben Tor 1' })
const uv1 = board('b-uv1', 'UV 1', 1, { location: 'E.01 Werkstatt, an der Tür' })
const field = (id: string, designation: string, position: number) => ({
  id,
  ...onAsset,
  distributionBoardId: uv1.id,
  designation,
  position,
})
const field2 = field('s-2', 'Feld 2', 2)
const field1 = field('s-1', 'Feld 1', 1)

function circuit(
  id: string,
  designation: string,
  section: string | null,
  position: number,
  more: object = {},
) {
  return {
    id,
    ...onAsset,
    distributionBoardId: uv1.id,
    boardSectionId: section,
    designation,
    consumer: null,
    overcurrentDevice: null,
    tripCharacteristic: null,
    ratedCurrentMilli: null,
    rcdType: null,
    ratedResidualCurrentMilli: null,
    cableType: null,
    cableCores: null,
    cableCrossSectionMilli: null,
    cableLengthMilli: null,
    cableInstallationMethod: null,
    position,
    ...more,
  }
}

const f3 = circuit('c-f3', 'F3', field1.id, 0, {
  consumer: 'Steckdosen Werkbank',
  overcurrentDevice: 'rcbo',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  rcdType: 'a',
  ratedResidualCurrentMilli: 30,
  cableType: 'NYM-J',
  cableCores: 3,
  cableCrossSectionMilli: 2_500,
  cableLengthMilli: 18_000,
  cableInstallationMethod: 'c',
})
const f4 = circuit('c-f4', 'F4', field1.id, 1, { consumer: 'Steckdosen Lager' })
// The same place on the board: the designation decides, the way a person counts.
const f10 = circuit('c-f10', 'F10', field2.id, 0, { consumer: 'CEE-Steckdose Werkstatt' })
const f2 = circuit('c-f2', 'F2', field2.id, 0, { consumer: 'Licht Lager' })
const f21 = circuit('c-f21', 'F21', null, 0, { consumer: 'Klingel und Rufanlage' })
const q1 = { ...circuit('c-q1', 'Q1', null, 0), distributionBoardId: hv.id }
const q2 = { ...circuit('c-q2', 'Q2', null, 1), distributionBoardId: hv.id }
const item = (id: string, designation: string, position: number, more: object = {}) => ({
  id,
  ...onAsset,
  circuitId: f3.id,
  designation,
  kind: null,
  manufacturer: null,
  model: null,
  serialNumber: null,
  position,
  ...more,
})
const lamp = item('e-lamp', 'Werkbankleuchte', 1, {
  kind: 'Leuchte',
  manufacturer: 'Beispiellicht',
  model: 'WL 60',
  serialNumber: 'WL-60-4471',
})
const socket = item('e-socket', 'Steckdose Werkbank links', 0, {
  kind: 'Steckdose',
  manufacturer: 'Beispielelektro',
  model: 'SD 20',
})

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
] as const

/** A server that holds the hall with its installation and the structure below it. */
class Server extends TestServer {
  constructor() {
    super()

    for (const [entity, rows] of Object.entries({
      properties: [yard],
      buildings: [hall],
      assets: [installation, lift],
      distribution_boards: [uv2, hv, uv1],
      board_sections: [field2, field1],
      circuits: [f3, f4, f10, f2, f21, q1, q2],
      equipment: [lamp, socket],
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
    commissionedOn: null,
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

/** The chart as the server hands it out; hands back the addresses asked for. */
function servingTheChart(): string[] {
  const answered = globalThis.fetch
  const asked: string[] = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if (!path.includes('/circuit-chart')) {
      return answered(path, init)
    }

    asked.push(path)

    return Promise.resolve(
      new Response(new Blob(['%PDF probe'], { type: 'application/pdf' }), { status: 200 }),
    )
  })
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:chart', revokeObjectURL: () => {} }),
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  return asked
}

const theCard = 'Verteiler dieser Anlage mit Ort und Zahl der Stromkreise'
const boardAt = `/anlagen/${installation.id}/verteiler/${uv1.id}`
const circuitAt = `${boardAt}/stromkreise/${f3.id}`

/** The groups of the list of a board, by name, each with the designations of its circuits. */
function groups(): [string, string[]][] {
  const list = screen.getByRole('region', { name: 'Stromkreise' })

  return within(list)
    .getAllByRole('group')
    .map((group) => [
      group.getAttribute('aria-label') ?? '',
      within(group)
        .getAllByRole('link')
        .map((link) => link.textContent.split(' ')[0] ?? ''),
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

describe('the boards in the file of a low-voltage installation', () => {
  it('stand under the evidence in their order, with what each is, where it hangs and its circuits', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', [], theFile())

    await waitFor(() => {
      expect(rowsOf(theCard)).toEqual([
        // The building it stands in above where it hangs (#495).
        ['HVHauptverteilung', 'Halle 1Halle, neben Tor 1', '2'],
        ['UV 1Unterverteilung, 2 Felder', 'Halle 1E.01 Werkstatt, an der Tür', '5'],
        ['UV 2Unterverteilung', 'Halle 1E.02 Lager', 'keiner'],
      ])
    })
    expect(screen.getByRole('link', { name: 'UV 1' }).getAttribute('href')).toBe(boardAt)
    expect(
      screen.getByText(
        'Im Stromkreisverzeichnis bekommt jeder Verteiler ein Blatt für seine Tür, in dieser Reihenfolge.',
      ),
    ).toBeTruthy()
    // In the main column after the evidence, before the defects.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)

    expect(headings.indexOf('Verteiler')).toBe(headings.indexOf('Nachweise') + 1)
  })

  it('stand nowhere in the file of another kind of asset', async () => {
    await mount(`/anlagen/${lift.id}`, 'technician', [], theFile(file({ ...lift })))
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Halle' })
    await screen.findByText('Stammdaten')

    expect(screen.queryByRole('region', { name: 'Verteiler' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stromkreisverzeichnis' })).toBeNull()
  })

  it('print every board from the file, and one board from its page', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', [], theFile())
    const asked = servingTheChart()

    fireEvent.click(await screen.findByRole('button', { name: 'Stromkreisverzeichnis' }))
    await waitFor(() => {
      expect(asked).toEqual([`/assets/${installation.id}/circuit-chart`])
    })

    fireEvent.click(screen.getByRole('link', { name: 'UV 1' }))
    await screen.findByRole('heading', { level: 1, name: 'UV 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Stromkreisverzeichnis' }))
    await waitFor(() => {
      expect(asked).toEqual([
        `/assets/${installation.id}/circuit-chart`,
        `/assets/${installation.id}/circuit-chart?board=${uv1.id}`,
      ])
    })
  })

  it('add a board at the end of the list, on the asset and nothing of its place', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', [], theFile())

    fireEvent.click(await screen.findByRole('button', { name: 'Verteiler hinzufügen' }))
    const form = dialog('Verteiler hinzufügen')

    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'UV Büro' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })

    const [made] = server.queued()

    expect(made).toMatchObject({
      entity: 'distribution_boards',
      kind: 'create',
      values: {
        assetId: installation.id,
        designation: 'UV Büro',
        kind: 'sub_distribution',
        position: 3,
        // Where the installation stands, unless another building is chosen (#495).
        buildingId: hall.id,
      },
    })
    expect(made?.values).not.toHaveProperty('propertyId')
    expect(made?.values).not.toHaveProperty('areaId')
  })
})

describe('the page of a board', () => {
  it('lists the circuits on the board directly first, then each section in its order, F2 before F10', async () => {
    await mount(boardAt)
    await screen.findByRole('heading', { level: 1, name: 'UV 1' })

    await waitFor(() => {
      expect(groups()).toEqual([
        ['Ohne Feld', ['F21']],
        ['Feld 1', ['F3', 'F4']],
        ['Feld 2', ['F2', 'F10']],
      ])
    })
    expect(screen.getByText('E.01 Werkstatt, an der Tür · 2 Felder, 5 Stromkreise')).toBeTruthy()
    expect(screen.getByText('Unterverteilung')).toBeTruthy()
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Liegenschaften', 'Werkhof Nord', 'Halle 1', 'Elektrische Anlage Halle 1'])
  })

  it('shows the circuit of the address beside the list, with every column of the chart and its equipment', async () => {
    await mount(circuitAt)
    const side = within(await screen.findByRole('region', { name: 'Stromkreis' }))

    await side.findByText('Steckdosen Werkbank', { selector: 'span' })
    expect(
      Object.fromEntries(
        side
          .getAllByRole('term')
          .map((term, index) => [
            term.textContent,
            side.getAllByRole('definition')[index]?.textContent,
          ]),
      ),
    ).toEqual({
      Feld: 'Feld 1',
      Verbraucher: 'Steckdosen Werkbank',
      Schutzeinrichtung: 'FI/LS B 16 A',
      RCD: 'Typ A 30 mA',
      Leitung: 'NYM-J 3 × 2,5 mm²',
      Länge: '18 m',
      Verlegeart: 'C: Direkt auf oder in der Wand',
    })
    expect(
      within(screen.getByRole('list', { name: 'Betriebsmittel' }))
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual([
      'Steckdose Werkbank linksSteckdose · Beispielelektro SD 20',
      'WerkbankleuchteLeuchte · Beispiellicht WL 60 · SN WL-60-4471',
    ])
    expect(screen.getByRole('link', { name: /^F3/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /^F4/ }).getAttribute('aria-current')).toBeNull()
  })

  it('adds a circuit to the section it was asked from, with its board and section and nothing of the place', async () => {
    await mount(boardAt)

    fireEvent.click(await screen.findByRole('button', { name: 'Stromkreis hinzufügen in Feld 1' }))
    const form = dialog('Stromkreis hinzufügen')

    expect((form.getByLabelText('Feld') as HTMLSelectElement).value).toBe(field1.id)
    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'F5' } })
    fireEvent.change(form.getByLabelText(/Verbraucher/), { target: { value: 'Licht Büro' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })

    const [made] = server.queued()

    expect(made).toMatchObject({
      entity: 'circuits',
      kind: 'create',
      values: {
        distributionBoardId: uv1.id,
        boardSectionId: field1.id,
        designation: 'F5',
        consumer: 'Licht Büro',
        // After F3 and F4, at the end of its section.
        position: 2,
      },
    })

    for (const field of ['assetId', 'propertyId', 'areaId']) {
      expect(made?.values).not.toHaveProperty(field)
    }
  })

  it('changes a circuit with what its form says, and moves nothing else', async () => {
    await mount(circuitAt)

    fireEvent.click(await screen.findByRole('button', { name: 'F3 bearbeiten' }))
    const form = dialog('F3 Steckdosen Werkbank bearbeiten')

    fireEvent.change(form.getByLabelText('Nennstrom in A'), { target: { value: '20' } })
    fireEvent.click(form.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.queued()).toHaveLength(1)
    })
    expect(server.queued()[0]).toMatchObject({
      entity: 'circuits',
      kind: 'update',
      id: f3.id,
      values: { ratedCurrentMilli: 20_000 },
    })
    expect(server.queued()[0]?.values).not.toHaveProperty('position')
  })

  it('offers the curves that go with the device, and no other', async () => {
    await mount(boardAt)

    fireEvent.click(await screen.findByRole('button', { name: 'Stromkreis hinzufügen' }))
    const form = dialog('Stromkreis hinzufügen')
    const protection = within(form.getByRole('group', { name: 'Schutzeinrichtung' }))
    const curves = () =>
      Array.from((protection.getByLabelText('Charakteristik') as HTMLSelectElement).options).map(
        (option) => option.text,
      )

    fireEvent.change(protection.getByLabelText('Art'), { target: { value: 'circuit_breaker' } })
    expect(curves()).toEqual(['nicht angegeben', 'B', 'C', 'D', 'K', 'Z'])

    fireEvent.change(protection.getByLabelText('Art'), { target: { value: 'fuse_nh' } })
    expect(curves()).toEqual(['nicht angegeben', 'gG', 'aM'])
  })

  it('says what is wrong with a figure of too many places, and queues nothing', async () => {
    await mount(boardAt)

    fireEvent.click(await screen.findByRole('button', { name: 'Stromkreis hinzufügen' }))
    const form = dialog('Stromkreis hinzufügen')

    fireEvent.change(form.getByLabelText(/Bezeichnung/), { target: { value: 'F5' } })
    fireEvent.change(form.getByLabelText('Länge in m'), { target: { value: '18,2505' } })
    fireEvent.click(form.getByRole('button', { name: 'Hinzufügen' }))

    expect(
      await form.findByText('Das ist keine Zahl mit höchstens 3 Nachkommastellen.'),
    ).toBeTruthy()
    expect(server.queued()).toEqual([])
  })

  it('moves a circuit by its handle into the next section, numbering that one afresh', async () => {
    await mount(boardAt)
    await screen.findByRole('button', { name: 'F4 verschieben' })

    fireEvent.keyDown(screen.getByRole('button', { name: 'F4 verschieben' }), { key: ' ' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'F4 verschieben' }), { key: 'ArrowDown' })
    expect(groups()).toEqual([
      ['Ohne Feld', ['F21']],
      ['Feld 1', ['F3']],
      ['Feld 2', ['F4', 'F2', 'F10']],
    ])
    // Nothing is written on the way.
    expect(server.queued()).toEqual([])
    fireEvent.keyDown(screen.getByRole('button', { name: 'F4 verschieben' }), { key: ' ' })

    await waitFor(() => {
      expect(server.queued()).toHaveLength(3)
    })
    expect(server.queued()).toEqual([
      {
        entity: 'circuits',
        kind: 'update',
        id: f4.id,
        values: { position: 0, boardSectionId: field2.id },
      },
      { entity: 'circuits', kind: 'update', id: f2.id, values: { position: 1 } },
      { entity: 'circuits', kind: 'update', id: f10.id, values: { position: 2 } },
    ])
  })
})

describe('the changes of a board', () => {
  it('lead whoever reads the log to the changes of this board', async () => {
    await mount(boardAt, 'management')

    const changes = await screen.findByRole('link', { name: 'Änderungen' })

    expect(changes.getAttribute('href')).toBe(
      `/einstellungen/protokoll?art=distribution_boards&datensatz=${uv1.id}`,
    )
  })

  it('are not offered to whoever may not read the log', async () => {
    await mount(boardAt, 'management', ['audit.read'])
    await screen.findByRole('heading', { level: 1, name: 'UV 1' })

    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })

  it('lead back from the log to the page of the board, by the board alone', async () => {
    const { router } = await mount(`/verteiler/${uv1.id}`, 'management')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(boardAt)
    })
    await screen.findByRole('heading', { level: 1, name: 'UV 1' })
  })
})

describe('the rights at the structure', () => {
  it('offer nothing to add, change or move without the right to take stock of assets', async () => {
    await mount(circuitAt, 'technician', ['asset.record'])
    await screen.findByRole('region', { name: 'Betriebsmittel' })

    for (const name of [
      'Bearbeiten',
      'F3 bearbeiten',
      'Stromkreis hinzufügen',
      'Feld hinzufügen',
      'Feld 1 bearbeiten',
      'Stromkreis hinzufügen in Feld 1',
      'Betriebsmittel hinzufügen',
      'Werkbankleuchte bearbeiten',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    expect(screen.queryAllByRole('button', { name: /verschieben$/ })).toEqual([])
    // Reading and printing stay.
    expect(screen.getByRole('button', { name: 'Stromkreisverzeichnis' })).toBeTruthy()
  })

  it('offer no board and no handle in the file without the right to take stock of assets', async () => {
    await mount(`/anlagen/${installation.id}`, 'technician', ['asset.record'], theFile())

    await waitFor(() => {
      expect(rowsOf(theCard)).toHaveLength(3)
    })
    expect(screen.queryByRole('button', { name: 'Verteiler hinzufügen' })).toBeNull()
    expect(screen.queryAllByRole('button', { name: /verschieben$/ })).toEqual([])
  })

  it('leave "Entfernen" out for whoever takes stock of assets and does not keep them', async () => {
    await mount(circuitAt, 'technician')

    fireEvent.click(await screen.findByRole('button', { name: 'F3 bearbeiten' }))
    const form = dialog('F3 Steckdosen Werkbank bearbeiten')

    expect(form.getByRole('button', { name: 'Speichern' })).toBeTruthy()
    expect(form.queryByRole('button', { name: 'Entfernen' })).toBeNull()

    fireEvent.click(form.getByRole('button', { name: 'Abbrechen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))

    expect(dialog('UV 1 bearbeiten').queryByRole('button', { name: 'Entfernen' })).toBeNull()
  })

  it('offer "Entfernen" to whoever keeps the assets, after a second question', async () => {
    const { router } = await mount(circuitAt, 'site_management')

    fireEvent.click(await screen.findByRole('button', { name: 'F3 bearbeiten' }))
    fireEvent.click(
      dialog('F3 Steckdosen Werkbank bearbeiten').getByRole('button', { name: 'Entfernen' }),
    )

    const question = within(
      screen.getByRole('alertdialog', { name: '„F3 Steckdosen Werkbank“ entfernen?' }),
    )

    expect(question.getByText('Mit dem Stromkreis gehen 2 Betriebsmittel.')).toBeTruthy()
    expect(server.queued()).toEqual([])
    fireEvent.click(question.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(server.queued()).toEqual([
        { entity: 'circuits', kind: 'delete', id: f3.id, values: {} },
      ])
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(boardAt)
    })
  })
})
