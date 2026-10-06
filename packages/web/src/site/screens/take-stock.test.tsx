import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  addressOf,
  afterEachSiteTest,
  blockedSheet,
  fromASheet,
  mountSite,
  onHeater,
  queued,
  sheetOfTheHall,
} from '../test-site.js'

/**
 * Taking stock on site (#99, 4.2 and 2.7 of the concept): an asset and a
 * room go into the outbox with what was typed, also without a network, after
 * the rules of `domain`; a possible duplicate among the assets of the device
 * is shown before anything is queued, and what the person passed goes with
 * the asset; the serial number is read by the camera, which opens with a tap
 * and never by itself; and a label from a sheet is given to an asset once.
 */

afterEach(afterEachSiteTest)

const taking = ['asset.read', 'asset.record', 'room.record', 'document.read', 'document.record']

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/** The form of an asset, once the device has its catalogue. */
async function assetForm(at: string, rights: readonly string[] = taking) {
  const site = await mountSite(at, { rights })

  await screen.findByLabelText('Anlagenart')

  return site
}

describe('an asset taken in on site', () => {
  it('goes into the outbox with what was typed, in the room the address names, and its page opens', async () => {
    const { server, router, cameraOpened } = await assetForm('/aufnehmen/raum/r-boiler')

    expect(screen.getByText('Schulzentrum Am Lindenhain, Schulhaus')).toBeTruthy()
    expect((screen.getByLabelText('Raum') as HTMLSelectElement).value).toBe('r-boiler')

    type('Anlagenart', 'probe.elevator')
    type('Bezeichnung', 'Aufzug Nord')
    type('Hersteller', 'Beispielhub')
    type('Seriennummer', 'FL-2026-10233')
    type('Baujahr', '2024')
    type('Feuerwehraufzug', 'true')
    type('Haltestellen', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(queued(server)).toHaveLength(1)
    })

    const [made] = queued(server)

    expect(made).toMatchObject({ entity: 'assets', kind: 'create' })
    expect(made?.values).toMatchObject({
      buildingId: 'b-house',
      roomId: 'r-boiler',
      kind: 'probe.elevator',
      name: 'Aufzug Nord',
      manufacturer: 'Beispielhub',
      serialNumber: 'FL-2026-10233',
      yearBuilt: 2024,
      values: '{"firefighters_lift":true,"stops":4}',
      distinctFrom: '[]',
    })
    // The number is the server's: a device sends none.
    expect(made?.values).not.toHaveProperty('number')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/anlagen/${String(server.operations()[0]?.recordId)}`,
      )
    })
    // Nobody asked for the camera, and it stayed closed.
    expect(cameraOpened()).toBe(0)
  })

  it('queues nothing while a rule of the model is broken, and says which field', async () => {
    const { server } = await assetForm('/aufnehmen/gebaeude/b-house')

    type('Baujahr', '24')
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    expect(await screen.findByText('Bitte prüfen Sie die markierten Felder.')).toBeTruthy()
    expect(screen.getByText('Das Baujahr ist eine ganze Zahl von 1800 bis 2100.')).toBeTruthy()
    // Long enough for a form that went on regardless to reach the server.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(queued(server)).toEqual([])
  })

  it('names the asset of the device that carries the serial number, and sends what was passed with the new one', async () => {
    const { server } = await assetForm('/aufnehmen/gebaeude/b-house')

    type('Anlagenart', 'probe.elevator')
    type('Bezeichnung', 'Aufzug Nord')
    type('Seriennummer', 'bt-750-22-0193')

    const card = screen.getByRole('region', { name: 'Mögliche Dublette' })

    expect(
      within(card).getByText('Diese Seriennummer trägt schon AN-00057 Aufzug Heizraum.'),
    ).toBeTruthy()
    expect(
      within(card).getByText(/^Schulhaus, E.14 Heizraum\. Ist es dieselbe Anlage/),
    ).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Vorhandene Anlage öffnen' })).toBeTruthy()
    expect(screen.getByText('Gleiche Seriennummer wie AN-00057 Aufzug Heizraum.')).toBeTruthy()
    // The decision is the card's: the bar under the form is gone.
    expect(screen.queryByRole('button', { name: 'Anlegen' })).toBeNull()
    expect(queued(server)).toEqual([])

    fireEvent.click(within(card).getByRole('button', { name: 'Trotzdem anlegen' }))

    await waitFor(() => {
      expect(queued(server)).toHaveLength(1)
    })
    expect(queued(server)[0]?.values).toMatchObject({
      serialNumber: 'bt-750-22-0193',
      distinctFrom: '["a-heater"]',
    })
  })

  it('files the photo of the type plate at the new asset, with the property of its building', async () => {
    const { server } = await assetForm('/aufnehmen/gebaeude/b-house')

    type('Anlagenart', 'probe.pump')
    type('Bezeichnung', 'Druckerhöhung')
    fireEvent.change(screen.getByLabelText('Foto des Typenschilds'), {
      target: { files: [new File(['%PDF-1.7'], 'schild.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(queued(server).map(({ entity, kind }) => `${entity} ${kind}`)).toEqual([
        'assets create',
        'attachments create',
        'attachment_versions create',
      ])
    })
    expect(queued(server)[1]?.values).toMatchObject({
      title: 'Typenschild',
      propertyId: 'p-school',
      assetId: server.operations()[0]?.recordId,
    })
  })

  it('goes on to its label where somebody asks for that', async () => {
    const { server, router } = await assetForm('/aufnehmen/gebaeude/b-house')

    type('Anlagenart', 'probe.pump')
    type('Bezeichnung', 'Druckerhöhung')
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen und Etikett zuordnen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/anlagen/${String(server.operations()[0]?.recordId)}/etikett`,
      )
    })
  })

  it('is offered to nobody who may not take assets into the register', async () => {
    const { server } = await mountSite('/aufnehmen/gebaeude/b-house', { rights: ['asset.read'] })

    expect(
      screen.getByText('Anlagen aufnehmen gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Bezeichnung')).toBeNull()
    expect(queued(server)).toEqual([])
  })
})

describe('the serial number read by the camera', () => {
  it('opens the camera with the tap, shows what it read and takes it into the field', async () => {
    const { cameraOpened, hold } = await assetForm('/aufnehmen/gebaeude/b-house')

    type('Bezeichnung', 'Feuerlöscher Tür')
    expect(cameraOpened()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Seriennummer mit der Kamera lesen' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Seriennummer lesen' }),
    ).toBeTruthy()
    await waitFor(() => {
      expect(cameraOpened()).toBe(1)
    })
    expect((screen.getByRole('button', { name: 'Übernehmen' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    hold('FL-2026-10233')
    // What was read stands in the picture, alone, and in the sentence under it.
    expect(await screen.findByText('FL-2026-10233')).toBeTruthy()
    expect(screen.getByText(/^Erkannt: FL-2026-10233\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))

    expect((await screen.findByLabelText<HTMLInputElement>('Seriennummer')).value).toBe(
      'FL-2026-10233',
    )
    // What was typed before the camera opened is still there.
    expect(screen.getByLabelText<HTMLInputElement>('Bezeichnung').value).toBe('Feuerlöscher Tür')
  })

  it('passes over a label of this application, and leaves the field alone with "Von Hand"', async () => {
    const { hold } = await assetForm('/aufnehmen/gebaeude/b-house')

    type('Seriennummer', 'von Hand')
    fireEvent.click(screen.getByRole('button', { name: 'Seriennummer mit der Kamera lesen' }))
    await screen.findByRole('heading', { level: 1, name: 'Seriennummer lesen' })

    hold(addressOf(fromASheet.code))
    // A few frames later nothing was taken for a serial number.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(screen.queryByText(/^Erkannt:/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Von Hand' }))

    expect((await screen.findByLabelText<HTMLInputElement>('Seriennummer')).value).toBe('von Hand')
  })
})

describe('a room taken in on site', () => {
  it('goes into the outbox on the floor the address names, and its page opens', async () => {
    const { server, router } = await mountSite('/aufnehmen/geschoss/f-ground', { rights: taking })

    expect(screen.getByText('Schulhaus, Erdgeschoss')).toBeTruthy()
    type('Raumnummer', 'E.16')
    type('Bezeichnung', 'Putzmittelraum')
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(queued(server)).toEqual([
        {
          entity: 'rooms',
          kind: 'create',
          values: expect.objectContaining({
            floorId: 'f-ground',
            number: 'E.16',
            name: 'Putzmittelraum',
          }) as unknown,
        },
      ])
    })
    // Building, property and area follow the floor on the server.
    expect(queued(server)[0]?.values).not.toHaveProperty('buildingId')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/raeume/${String(server.operations()[0]?.recordId)}`,
      )
    })
  })

  it('queues no room that has neither a number nor a name', async () => {
    const { server } = await mountSite('/aufnehmen/geschoss/f-ground', { rights: taking })

    type('Nutzung', 'Lager')
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    expect(await screen.findByText('Bitte prüfen Sie die markierten Felder.')).toBeTruthy()
    expect(queued(server)).toEqual([])
  })

  it('is offered to nobody who may not take rooms into the register', async () => {
    await mountSite('/aufnehmen/geschoss/f-ground', { rights: ['asset.read'] })

    expect(
      screen.getByText('Räume aufnehmen gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Raumnummer')).toBeNull()
  })
})

describe('a label from a sheet, given to an asset', () => {
  const giving = ['asset.read', 'asset.record']

  it('is read by the camera, named with the asset that gets it, and queued with "Zuordnen"', async () => {
    const { server, router, hold } = await mountSite('/anlagen/a-rod/etikett', { rights: giving })

    expect(screen.getByRole('heading', { level: 1, name: 'Etikett zuordnen' })).toBeTruthy()
    hold(addressOf(fromASheet.code))

    const gets = await screen.findByRole('region', { name: 'Bekommt das Etikett' })

    expect(within(gets).getByText('AN-00046 Blitzschutzanlage')).toBeTruthy()
    expect(screen.getByText('TA6W-3XQ7-M2K9-PDH4')).toBeTruthy()
    expect(queued(server)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Zuordnen' }))

    await waitFor(() => {
      expect(queued(server)).toEqual([
        { entity: 'labels', kind: 'update', values: { assetId: 'a-rod' } },
      ])
    })
    expect(server.operations()[0]?.recordId).toBe(fromASheet.id)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-rod')
    })
  })

  it.each([
    [
      'a blocked one',
      'a-rod',
      blockedSheet.code,
      'Dieses Etikett ist gesperrt und lässt sich keiner Anlage mehr zuordnen.',
    ],
    [
      'one that hangs on an asset',
      'a-rod',
      onHeater.code,
      'Dieses Etikett hängt schon an einer Anlage oder an einem Raum.',
    ],
    [
      'one printed for another property',
      'a-rod',
      sheetOfTheHall.code,
      'Dieses Etikett ist für eine andere Liegenschaft gedruckt.',
    ],
    [
      'a second one for an asset that has its label',
      'a-heater',
      fromASheet.code,
      'Diese Anlage hat schon ein gültiges Etikett.',
    ],
  ])('is not given where the rule says no: %s', async (_what, assetId, code, sentence) => {
    const { server, hold } = await mountSite(`/anlagen/${assetId}/etikett`, { rights: giving })

    hold(addressOf(code))

    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Zuordnen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Anderes scannen' })).toBeTruthy()
    expect(queued(server)).toEqual([])
  })

  it('says so where the code is no label of this application', async () => {
    const { hold } = await mountSite('/anlagen/a-rod/etikett', { rights: giving })

    hold('FL-2026-10233')

    expect(
      await screen.findByText('Der Code gehört zu keinem Etikett dieser Anwendung.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Zuordnen' })).toBeNull()
  })

  it('is offered to nobody who may not take assets into the register, and opens no camera for them', async () => {
    const { cameraOpened } = await mountSite('/anlagen/a-rod/etikett', { rights: ['asset.read'] })

    expect(
      screen.getByText('Etiketten zuordnen gehört nicht zu den Rechten dieses Zugangs.'),
    ).toBeTruthy()
    expect(cameraOpened()).toBe(0)
  })
})
