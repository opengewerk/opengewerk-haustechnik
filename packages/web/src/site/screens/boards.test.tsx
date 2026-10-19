import { boardAssetKind } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import {
  afterEachSiteTest,
  goOffline,
  goOnline,
  house,
  mountSite,
  queued,
  school,
  schoolServer,
  storeRoom,
} from '../test-site.js'

/**
 * The electrical structure of a low-voltage installation on site (#349): its
 * boards on the page of the asset, a board with its circuits section by
 * section in the order of the chart, a circuit with its equipment, and the
 * forms that add and change them, through the outbox and so also without a
 * network. Whoever takes stock of assets does; nothing is removed on site.
 */

afterEach(afterEachSiteTest)

const place = { propertyId: school.id, areaId: 'a-sued' }
const installation = {
  id: 'a-install',
  ...place,
  buildingId: house.id,
  roomId: storeRoom.id,
  parentAssetId: null,
  kind: boardAssetKind,
  number: 'AN-00012',
  name: 'Elektrische Anlage Schulhaus',
  mark: null,
  manufacturer: null,
  model: null,
  serialNumber: null,
  yearBuilt: null,
  values: '{}',
}
const onAsset = { ...place, assetId: installation.id }
const hv = {
  id: 'b-hv',
  ...onAsset,
  kind: 'main_distribution',
  designation: 'HV',
  location: 'Keller, neben dem Zähler',
  position: 0,
}
const uv1 = {
  id: 'b-uv1',
  ...onAsset,
  kind: 'sub_distribution',
  designation: 'UV 1',
  location: 'E.15 Lager, an der Tür',
  position: 1,
}
const empty = { ...uv1, id: 'b-empty', designation: 'UV Büro', location: null, position: 2 }
const field1 = {
  id: 's-1',
  ...onAsset,
  distributionBoardId: uv1.id,
  designation: 'Feld 1',
  position: 1,
}
const field2 = { ...field1, id: 's-2', designation: 'Feld 2', position: 2 }

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
// The same place on the board: the designation decides, the way a person counts.
const f10 = circuit('c-f10', 'F10', field2.id, 0, { consumer: 'CEE-Steckdose Werkstatt' })
const f2 = circuit('c-f2', 'F2', field2.id, 0, { consumer: 'Licht Lager' })
const f21 = circuit('c-f21', 'F21', null, 0, { consumer: 'Klingel und Rufanlage' })
const q1 = { ...circuit('c-q1', 'Q1', null, 0), distributionBoardId: hv.id }
const lamp = {
  id: 'e-lamp',
  ...onAsset,
  circuitId: f3.id,
  designation: 'Werkbankleuchte',
  kind: 'Leuchte',
  manufacturer: 'Beispiellicht',
  model: 'WL 60',
  serialNumber: 'WL-60-4471',
  position: 0,
}

/** The school with an installation in its store room and the structure below it. */
function server() {
  const held = schoolServer()

  for (const [entity, rows] of Object.entries({
    assets: [installation],
    distribution_boards: [empty, uv1, hv],
    board_sections: [field2, field1],
    circuits: [f3, f10, f2, f21, q1],
    equipment: [lamp],
  })) {
    for (const row of rows) {
      held.put(entity, row)
    }
  }

  return held
}

const technician = memberIn('technician')
const withoutStockTaking = technician.rights.filter((right) => right !== 'asset.record')
const assetAt = `/anlagen/${installation.id}`
const boardAt = `${assetAt}/verteiler/${uv1.id}`
const circuitAt = `${boardAt}/stromkreise/${f3.id}`

/** The sections of a board on site, by name, each with the designations of its circuits. */
function sections(): [string, string[]][] {
  return screen
    .getAllByRole('region')
    .filter((region) => region.tagName === 'SECTION' && region.hasAttribute('aria-label'))
    .map((region) => [
      region.getAttribute('aria-label') ?? '',
      within(region)
        .queryAllByRole('link')
        .map((link) => link.textContent.split(' ')[0] ?? ''),
    ])
}

describe('the boards of a low-voltage installation on site', () => {
  it('stand right under the path, each with what it is, where it hangs and what it holds', async () => {
    await mountSite(assetAt, { server: server() })
    const block = within(await screen.findByRole('region', { name: 'Verteiler' }))

    await waitFor(() => {
      expect(block.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'HVHauptverteilung, Keller, neben dem Zähler1 Stromkreis',
        'UV 1Unterverteilung, E.15 Lager, an der Tür2 Felder, 4 Stromkreise',
        'UV BüroUnterverteilungnoch kein Stromkreis',
      ])
    })
    expect(block.getByText('3')).toBeTruthy()
    expect(block.getByRole('link', { name: /^UV 1/ }).getAttribute('href')).toBe(`/m${boardAt}`)

    // Before what is known about the asset.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)

    expect(headings.indexOf('Verteiler')).toBeLessThan(headings.indexOf('Angaben'))
  })

  it('stand nowhere at another kind of asset', async () => {
    await mountSite('/anlagen/a-heater', { server: server() })
    await screen.findByRole('region', { name: 'Angaben' })

    expect(screen.queryByRole('region', { name: 'Verteiler' })).toBeNull()
  })

  it('list the circuits on the board directly first, then each section, F2 before F10', async () => {
    await mountSite(boardAt, { server: server() })
    await screen.findByRole('heading', { level: 1, name: 'UV 1' })

    expect(sections()).toEqual([
      ['Ohne Feld', ['F21']],
      ['Feld 1', ['F3']],
      ['Feld 2', ['F2', 'F10']],
    ])
    expect(screen.getByText('Unterverteilung, E.15 Lager, an der Tür')).toBeTruthy()
    expect(screen.getByText('1 Stromkreis, direkt am Verteiler')).toBeTruthy()
    // What nothing is known of yet says so, in the colour of waiting.
    expect(
      screen.getAllByText('Noch nichts zu Schutzeinrichtung und Leitung erfasst.'),
    ).toHaveLength(3)
  })

  it('show a circuit with what is known about it and its equipment', async () => {
    await mountSite(circuitAt, { server: server() })
    await screen.findByRole('heading', { level: 1, name: 'F3' })

    const known = within(screen.getByRole('region', { name: 'Angaben' }))

    expect(known.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Verbraucher',
      'Schutzeinrichtung',
      'RCD',
      'Leitung',
      'Länge',
      'Verlegeart',
    ])
    expect(screen.getByText('Stromkreis, Feld 1, UV 1')).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Betriebsmittel' }))
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual(['WerkbankleuchteLeuchte, Beispiellicht WL 60, SN WL-60-4471'])
  })
})

describe('taking the structure down on site', () => {
  it('adds a circuit without a network, on its board in the last section, and says it waits on the device', async () => {
    const site = await mountSite(boardAt, { server: server() })

    goOffline(site.server)
    fireEvent.click(await screen.findByRole('button', { name: 'Stromkreis hinzufügen' }))

    await screen.findByRole('heading', { level: 1, name: 'Stromkreis hinzufügen' })
    expect(screen.getByText('UV 1, Elektrische Anlage Schulhaus')).toBeTruthy()
    expect(
      screen.getByText('Auf dem Gerät gesichert, übertragen beim nächsten Abgleich.'),
    ).toBeTruthy()
    expect((screen.getByLabelText('Feld') as HTMLSelectElement).value).toBe(field2.id)

    fireEvent.change(screen.getByLabelText(/Bezeichnung/), { target: { value: 'F15' } })
    fireEvent.change(screen.getByLabelText(/Verbraucher/), {
      target: { value: 'Steckdosen Waschplatz' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(site.router.state.location.pathname).toBe(boardAt)
    })
    expect(sections().at(-1)).toEqual(['Feld 2', ['F2', 'F10', 'F15']])
    expect(screen.getByText('noch nicht übertragen')).toBeTruthy()
    expect(queued(site.server)).toEqual([])

    goOnline(site.server)

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(1)
    })

    const [made] = queued(site.server)

    expect(made).toMatchObject({
      entity: 'circuits',
      kind: 'create',
      values: {
        distributionBoardId: uv1.id,
        boardSectionId: field2.id,
        designation: 'F15',
        consumer: 'Steckdosen Waschplatz',
        position: 1,
      },
    })

    for (const field of ['assetId', 'propertyId', 'areaId']) {
      expect(made?.values).not.toHaveProperty(field)
    }
  })

  it('changes a circuit in the same form, filled in', async () => {
    const site = await mountSite(circuitAt, { server: server() })

    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    await screen.findByRole('heading', { level: 1, name: 'F3 bearbeiten' })

    expect((screen.getByLabelText(/Verbraucher/) as HTMLInputElement).value).toBe(
      'Steckdosen Werkbank',
    )
    fireEvent.change(screen.getByLabelText(/Nennstrom/), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(1)
    })
    expect(queued(site.server)[0]).toMatchObject({
      entity: 'circuits',
      kind: 'update',
      values: { ratedCurrentMilli: 20_000 },
    })
    await waitFor(() => {
      expect(site.router.state.location.pathname).toBe(circuitAt)
    })
  })

  it('adds a section and a piece of equipment, each at the end of its list', async () => {
    const site = await mountSite(boardAt, { server: server() })

    fireEvent.click(await screen.findByRole('button', { name: 'Feld hinzufügen' }))
    fireEvent.change(await screen.findByLabelText(/Bezeichnung/), { target: { value: 'Feld 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(1)
    })
    expect(queued(site.server)[0]).toMatchObject({
      entity: 'board_sections',
      kind: 'create',
      values: { distributionBoardId: uv1.id, designation: 'Feld 3', position: 3 },
    })

    await site.router.navigate({ to: circuitAt })
    fireEvent.click(await screen.findByRole('button', { name: 'Betriebsmittel hinzufügen' }))
    fireEvent.change(await screen.findByLabelText(/Bezeichnung/), {
      target: { value: 'Steckdose Werkbank rechts' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(2)
    })
    expect(queued(site.server)[1]).toMatchObject({
      entity: 'equipment',
      kind: 'create',
      values: { circuitId: f3.id, designation: 'Steckdose Werkbank rechts', position: 1 },
    })
    expect(queued(site.server)[1]?.values).not.toHaveProperty('assetId')
  })

  it('asks for the designation before anything is queued', async () => {
    const site = await mountSite(`${assetAt}/verteiler/neu`, { server: server() })

    fireEvent.click(await screen.findByRole('button', { name: 'Hinzufügen' }))

    expect(await screen.findByText('Die Bezeichnung fehlt.')).toBeTruthy()
    expect(queued(site.server)).toEqual([])
  })
})

describe('the rights at the structure on site', () => {
  it('offer no way to remove a part, also to whoever keeps the assets', async () => {
    const site = await mountSite(circuitAt, { server: server(), role: 'site_management' })

    for (const [at, name] of [
      [circuitAt, 'F3'],
      [`${circuitAt}/bearbeiten`, 'F3 bearbeiten'],
      [`${circuitAt}/betriebsmittel/${lamp.id}/bearbeiten`, 'Werkbankleuchte bearbeiten'],
      [boardAt, 'UV 1'],
      [`${boardAt}/bearbeiten`, 'Verteiler bearbeiten'],
      [`${boardAt}/felder/${field1.id}/bearbeiten`, 'Feld 1 bearbeiten'],
    ] as const) {
      await site.router.navigate({ to: at })
      await screen.findByRole('heading', { level: 1, name })

      expect(screen.queryAllByRole('button', { name: /entfernen/i })).toEqual([])
    }
  })

  it('offer nothing to add or change without the right to take stock of assets', async () => {
    const site = await mountSite(assetAt, { server: server(), rights: withoutStockTaking })

    await screen.findByRole('region', { name: 'Verteiler' })
    expect(screen.queryByRole('button', { name: 'Verteiler hinzufügen' })).toBeNull()

    await site.router.navigate({ to: boardAt })
    await screen.findByRole('heading', { level: 1, name: 'UV 1' })

    for (const name of [
      'Stromkreis hinzufügen',
      'Feld hinzufügen',
      'Verteiler bearbeiten',
      'Feld 1 bearbeiten',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    await site.router.navigate({ to: circuitAt })
    await screen.findByRole('heading', { level: 1, name: 'F3' })
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Betriebsmittel hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Werkbankleuchte bearbeiten' })).toBeNull()

    await site.router.navigate({ to: `${boardAt}/stromkreise/neu` })
    expect(
      await screen.findByText('Anlagen aufnehmen gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).toBeNull()
  })
})
