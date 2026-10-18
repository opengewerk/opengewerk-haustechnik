import { createHash } from 'node:crypto'

import { readTravel } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { travelKeep } from '../sync/travel.js'
import { afterEachSiteTest, boilerRoom, heater, mountSite, schoolServer } from './test-site.js'

/**
 * Documents for the road on site (#348), as the boards "Anlage: Unterlagen
 * für unterwegs merken", "Anlage: Unterlagen gemerkt, ohne Netz", "Raum:
 * Unterlagen gemerkt" and "Unterlagen für unterwegs" draw them.
 */

const storageOf = Object.getOwnPropertyDescriptor(navigator, 'storage')

afterEach(() => {
  afterEachSiteTest()

  if (storageOf) {
    Object.defineProperty(navigator, 'storage', storageOf)
  } else {
    delete (navigator as { storage?: unknown }).storage
  }
})

const reading = ['asset.read', 'location.read', 'document.read']
const manual = new TextEncoder().encode('%PDF-1.7 Betriebsanleitung SW 750')
const scheme = new TextEncoder().encode('%PDF-1.7 Schema der Heizzentrale')

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The school with a manual at the heater and a scheme on the wall of its room. */
function withDocuments() {
  const server = schoolServer()
  const place = { propertyId: 'p-school', areaId: 'a-sued', buildingId: null, activityId: null }

  server.put('attachments', {
    id: 'd-manual',
    ...place,
    roomId: null,
    assetId: heater.id,
    title: 'Betriebsanleitung SW 750',
    kind: 'operating_manual',
  })
  server.put('attachments', {
    id: 'd-scheme',
    ...place,
    roomId: boilerRoom.id,
    assetId: null,
    title: 'Schema der Heizzentrale',
    kind: null,
  })

  for (const [order, attachmentId, bytes] of [
    [11, 'd-manual', manual],
    [12, 'd-scheme', scheme],
  ] as const) {
    server.put('attachment_versions', {
      id: `00000000-0000-7000-8000-0000000000${String(order)}`,
      attachmentId,
      sha256: hashOf(bytes),
      fileName: `${attachmentId}.pdf`,
      mediaType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      previewSha256: null,
      createdBy: 'u-kraemer',
      createdAt: '2026-10-18T09:00:00.000Z',
    })
  }

  return server
}

function documents(): HTMLElement {
  return screen.getByRole('region', { name: 'Dokumente' })
}

describe('the documents of an asset for the road, on site', () => {
  it('are offered with how many and how much, and once kept say that they lie on the device', async () => {
    const { client } = await mountSite(`/anlagen/${heater.id}`, {
      server: withDocuments(),
      rights: reading,
    })

    await within(documents()).findByText('Betriebsanleitung SW 750')
    expect(
      within(documents()).getByText(
        'Holt 1 Datei, 33 Byte, auf dieses Gerät, damit sie ohne Netz aufgehen.',
      ),
    ).toBeTruthy()

    // The file as the server would hand it out; the round finds it on the device.
    await client.rememberFile(hashOf(manual), manual.buffer as ArrayBuffer, 'application/pdf')
    fireEvent.click(within(documents()).getByRole('button', { name: 'Für unterwegs merken' }))

    await within(documents()).findByText('Für unterwegs gemerkt')
    await waitFor(() => {
      expect(documents().textContent).toContain('· auf dem Gerät')
    })
    expect(readTravel(client.kept(travelKeep))).toEqual({
      places: [{ kind: 'asset', id: heater.id }],
      files: [hashOf(manual)],
    })

    fireEvent.click(within(documents()).getByRole('button', { name: 'Vergessen' }))
    await within(documents()).findByRole('button', { name: 'Für unterwegs merken' })
    await waitFor(() => {
      expect(readTravel(client.kept(travelKeep))).toEqual({ places: [], files: [] })
    })
    expect(await client.readFile(hashOf(manual))).toBeNull()
  })

  it('are not kept where the browser gives the page too little room', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: () => Promise.resolve({ quota: 1_000, usage: 990 }),
        persist: () => Promise.resolve(false),
      },
    })

    const { client } = await mountSite(`/anlagen/${heater.id}`, {
      server: withDocuments(),
      rights: reading,
    })

    await within(documents()).findByText('Betriebsanleitung SW 750')
    fireEvent.click(within(documents()).getByRole('button', { name: 'Für unterwegs merken' }))

    expect((await within(documents()).findByRole('alert')).textContent).toBe(
      'Auf diesem Gerät ist nicht genug Platz: 33 Byte gebraucht, 10 Byte frei.',
    )
    expect(client.kept(travelKeep)).toBeNull()
  })

  it('are kept for a room, the documents of the room itself', async () => {
    const { client } = await mountSite(`/raeume/${boilerRoom.id}`, {
      server: withDocuments(),
      rights: reading,
    })

    await within(documents()).findByText('Schema der Heizzentrale')
    fireEvent.click(within(documents()).getByRole('button', { name: 'Für unterwegs merken' }))

    await waitFor(() => {
      expect(readTravel(client.kept(travelKeep)).places).toEqual([
        { kind: 'room', id: boilerRoom.id },
      ])
    })
  })

  it('are not offered at a room without a document', async () => {
    await mountSite('/raeume/r-store', { server: withDocuments(), rights: reading })

    await screen.findByText('Noch kein Dokument an diesem Raum.')
    expect(screen.queryByRole('button', { name: 'Für unterwegs merken' })).toBeNull()
  })
})

describe('what a device keeps for the road, on site', () => {
  it('is listed with where each place is, how many files and how much, and a place is forgotten there', async () => {
    const { client, router } = await mountSite(`/anlagen/${heater.id}`, {
      server: withDocuments(),
      rights: reading,
    })

    await client.rememberFile(hashOf(manual), manual.buffer as ArrayBuffer, 'application/pdf')
    await within(documents()).findByText('Betriebsanleitung SW 750')
    fireEvent.click(within(documents()).getByRole('button', { name: 'Für unterwegs merken' }))
    await within(documents()).findByText('Für unterwegs gemerkt')

    // From the menu, with what is kept.
    fireEvent.click((await screen.findAllByRole('button', { name: /Menü/ }))[0] as HTMLElement)

    const row = within(await screen.findByRole('dialog', { name: 'Menü' })).getByRole('link', {
      name: /Unterlagen für unterwegs/,
    })

    expect(row.textContent).toBe('Unterlagen für unterwegs1 Anlage, 33 Byte')
    fireEvent.click(row)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/unterwegs')
    })

    const list = await screen.findByRole('list', { name: 'Unterlagen für unterwegs' })

    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'AN-00057 Aufzug HeizraumAnlage · Schulhaus, E.14 Heizraum1 Datei, 33 ByteVergessen',
    ])
    expect(screen.getByText('Belegt 33 Byte')).toBeTruthy()

    fireEvent.click(within(list).getByRole('button', { name: 'Vergessen' }))

    await screen.findByText(
      'Noch ist nichts gemerkt. An einer Anlage oder einem Raum unter „Dokumente“ „Für unterwegs merken“ wählen.',
    )
  })
})
