import { inverterAssetKind } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import {
  addressOf,
  afterEachSiteTest,
  fromASheet,
  goOffline,
  goOnline,
  house,
  mountSite,
  queued,
  school,
  schoolServer,
} from '../test-site.js'
import { moduleSerialFromCode } from './pv.js'

/**
 * The PV structure of a PV installation on site (#461): its inverters with
 * their strings on the page of the asset and its power among the facts, a
 * string with its modules, and the forms that add and change them, through
 * the outbox and so also without a network; the serial number of a module is
 * read from the code on its label. Whoever takes stock of assets does;
 * nothing is removed on site.
 */

afterEach(afterEachSiteTest)

const place = { propertyId: school.id, areaId: 'a-sued' }
const installation = {
  id: 'a-pv',
  ...place,
  buildingId: house.id,
  roomId: null,
  parentAssetId: null,
  kind: inverterAssetKind,
  number: 'AN-00014',
  name: 'PV-Anlage Dach Schulhaus',
  mark: null,
  manufacturer: null,
  model: null,
  serialNumber: null,
  yearBuilt: null,
  values: '{}',
}
const onAsset = { ...place, assetId: installation.id }
const wr1 = {
  id: 'i-wr1',
  ...onAsset,
  designation: 'WR 1',
  location: 'E.02 Lager, an der Nordwand',
  manufacturer: 'Beispielwandler',
  model: 'BW 10.0',
  serialNumber: null,
  ratedPowerW: 10_000,
  mppInputs: 2,
  position: 0,
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
const s1 = string('st-1', 'String 1', 1)
const s2 = string('st-2', 'String 2', 2)
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
const m1 = module('m-1', s1.id, 1, 'BS4-2306-1101')
const m2 = module('m-2', s1.id, 2, null)

/** The school with a PV installation on its house and the structure below it. */
function server() {
  const held = schoolServer()

  for (const [entity, rows] of Object.entries({
    assets: [installation],
    inverters: [wr1],
    pv_strings: [s2, s1],
    pv_modules: [m2, m1],
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
const stringAt = `${assetAt}/wechselrichter/${wr1.id}/strings/${s1.id}`

describe('the inverters of a PV installation on site', () => {
  it('stand right under the path, each with its strings, and the power of the installation among its facts', async () => {
    await mountSite(assetAt, { server: server() })
    const block = within(await screen.findByRole('region', { name: 'Wechselrichter' }))

    await waitFor(() => {
      expect(block.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'String 1MPP-Eingang 1, 2 Module, 0,80 kWp',
        'String 2MPP-Eingang 2, noch keine Module',
      ])
    })
    expect(block.getByText('Beispielwandler BW 10.0, 10,0 kW')).toBeTruthy()
    expect(block.getByText('E.02 Lager, an der Nordwand')).toBeTruthy()
    expect(block.getByRole('link', { name: /^String 1/ }).getAttribute('href')).toBe(
      `/m${stringAt}`,
    )

    const facts = within(screen.getByRole('region', { name: 'Angaben' }))

    expect(facts.getByText('0,80 kWp aus 2 Modulen')).toBeTruthy()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)

    expect(headings.indexOf('Wechselrichter')).toBeLessThan(headings.indexOf('Angaben'))
  })

  it('stand nowhere at another kind of asset', async () => {
    await mountSite('/anlagen/a-heater', { server: server() })
    await screen.findByRole('region', { name: 'Angaben' })

    expect(screen.queryByRole('region', { name: 'Wechselrichter' })).toBeNull()
    expect(screen.queryByText(/kWp/)).toBeNull()
  })

  it('show a string with what is known about it and its modules in the order they were taken up', async () => {
    await mountSite(stringAt, { server: server() })
    await screen.findByRole('heading', { level: 1, name: 'String 1' })

    const known = within(screen.getByRole('region', { name: 'Angaben' }))

    expect(
      known.getAllByRole('term').map((term) => [term.textContent, term.nextSibling?.textContent]),
    ).toEqual([
      ['MPP-Eingang', '1 von 2'],
      ['Module', '2 Module, zusammen 0,80 kWp'],
    ])
    expect(screen.getByText('WR 1, PV-Anlage Dach Schulhaus')).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Module' }))
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual([
      '1 SN BS4-2306-1101Beispielsolar BS 400 M, 400 Wp',
      '2 Ohne SeriennummerBeispielsolar BS 400 M, 400 Wp',
    ])
  })
})

describe('taking the PV structure up on site', () => {
  it('adds a module without a network, its serial number read from the code on its label', async () => {
    const site = await mountSite(stringAt, { server: server() })

    goOffline(site.server)
    fireEvent.click(await screen.findByRole('button', { name: 'Modul hinzufügen' }))

    await screen.findByRole('heading', { level: 1, name: 'Modul hinzufügen' })
    expect(screen.getByText('String 1, WR 1')).toBeTruthy()
    // As the last module of the string.
    expect(screen.getByLabelText<HTMLInputElement>('Hersteller').value).toBe('Beispielsolar')
    expect(screen.getByLabelText<HTMLInputElement>('Modell').value).toBe('BS 400 M')
    expect(screen.getByLabelText<HTMLInputElement>('Leistung').value).toBe('400')
    expect(site.cameraOpened()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Seriennummer scannen' }))
    await screen.findByRole('heading', { level: 1, name: 'Seriennummer lesen' })
    await waitFor(() => {
      expect(site.cameraOpened()).toBe(1)
    })

    site.hold('BS4-2306-1103')
    expect(await screen.findByText(/^Erkannt: BS4-2306-1103\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))

    const field = await screen.findByLabelText<HTMLInputElement>('Seriennummer')

    expect(field.value).toBe('BS4-2306-1103')
    expect(document.activeElement).toBe(field)
    expect(
      screen.getByText('Vom Code auf dem Etikett gelesen. Groß und klein wie auf dem Etikett.'),
    ).toBeTruthy()
    // What was in the form before the camera opened is still there.
    expect(screen.getByLabelText<HTMLInputElement>('Hersteller').value).toBe('Beispielsolar')

    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(site.router.state.location.pathname).toBe(stringAt)
    })
    expect(screen.getByText('SN BS4-2306-1103')).toBeTruthy()
    expect(queued(site.server)).toEqual([])

    goOnline(site.server)

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(1)
    })

    const [made] = queued(site.server)

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

  it('takes no label of this application and nothing longer than a serial number from a code', () => {
    expect(moduleSerialFromCode('  BS4-2306-1103 ')).toBe('BS4-2306-1103')
    expect(moduleSerialFromCode(addressOf(fromASheet.code))).toBeNull()
    expect(moduleSerialFromCode('x'.repeat(65))).toBeNull()
    expect(moduleSerialFromCode('   ')).toBeNull()
  })

  it('says what is wrong with the power of a module, and queues nothing', async () => {
    const site = await mountSite(`${stringAt}/module/neu`, { server: server() })

    fireEvent.change(await screen.findByLabelText('Leistung'), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    expect(
      await screen.findByText('Die Leistung eines Moduls ist größer als 0 und höchstens 2000 Wp.'),
    ).toBeTruthy()
    expect(queued(site.server)).toEqual([])
  })

  it('adds an inverter on the asset with where it hangs, and a string that opens its page', async () => {
    const site = await mountSite(assetAt, { server: server() })

    fireEvent.click(await screen.findByRole('button', { name: 'Wechselrichter hinzufügen' }))
    await screen.findByRole('heading', { level: 1, name: 'Wechselrichter hinzufügen' })
    fireEvent.change(screen.getByLabelText(/Bezeichnung/), { target: { value: 'WR 2' } })
    fireEvent.change(screen.getByLabelText('Ort'), { target: { value: 'Dach, am Aufgang' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(1)
    })
    expect(queued(site.server)[0]).toMatchObject({
      entity: 'inverters',
      kind: 'create',
      values: {
        assetId: installation.id,
        designation: 'WR 2',
        location: 'Dach, am Aufgang',
        position: 1,
      },
    })
    expect(queued(site.server)[0]?.values).not.toHaveProperty('propertyId')

    await waitFor(() => {
      expect(site.router.state.location.pathname).toBe(assetAt)
    })
    fireEvent.click(await screen.findByRole('button', { name: 'String hinzufügen an WR 1' }))
    await screen.findByRole('heading', { level: 1, name: 'String hinzufügen' })
    fireEvent.change(screen.getByLabelText(/Bezeichnung/), { target: { value: 'String 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(queued(site.server)).toHaveLength(2)
    })

    const made = queued(site.server)[1]

    expect(made).toMatchObject({
      entity: 'pv_strings',
      kind: 'create',
      values: { inverterId: wr1.id, designation: 'String 3', position: 3 },
    })
    await screen.findByRole('heading', { level: 1, name: 'String 3' })
  })
})

describe('the rights at the PV structure on site', () => {
  it('offer no way to remove a part, also to whoever keeps the assets', async () => {
    const site = await mountSite(stringAt, { server: server(), role: 'site_management' })

    for (const [at, name] of [
      [stringAt, 'String 1'],
      [`${stringAt}/bearbeiten`, 'String 1 bearbeiten'],
      [`${stringAt}/module/${m1.id}/bearbeiten`, 'Modul 1 bearbeiten'],
      [`${assetAt}/wechselrichter/${wr1.id}/bearbeiten`, 'WR 1 bearbeiten'],
    ] as const) {
      await site.router.navigate({ to: at })
      await screen.findByRole('heading', { level: 1, name })

      expect(screen.queryAllByRole('button', { name: /entfernen/i })).toEqual([])
    }
  })

  it('offer nothing to add or change without the right to take stock of assets', async () => {
    const site = await mountSite(assetAt, { server: server(), rights: withoutStockTaking })

    await screen.findByRole('region', { name: 'Wechselrichter' })
    await screen.findByRole('link', { name: /^String 1/ })

    for (const name of ['Wechselrichter hinzufügen', /^String hinzufügen/, 'WR 1 bearbeiten']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    await site.router.navigate({ to: stringAt })
    await screen.findByRole('heading', { level: 1, name: 'String 1' })

    for (const name of ['Bearbeiten', 'Modul hinzufügen', 'Modul 1 bearbeiten']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    await site.router.navigate({ to: `${stringAt}/module/neu` })
    expect(
      await screen.findByText('Anlagen aufnehmen gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Seriennummer scannen' })).toBeNull()
  })
})
