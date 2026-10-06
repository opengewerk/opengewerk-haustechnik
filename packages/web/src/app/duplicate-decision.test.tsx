import type { SyncConflict } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  afterEachSiteTest,
  fromASheet,
  heater,
  mountSite,
  queued,
  rod,
  schoolServer,
} from '../site/test-site.js'
import { followersOf, isDuplicateConflict } from './duplicate-decision.js'

/**
 * The possible duplicate of an asset taken stock of on site, as the server
 * found it when the device exchanged (#99, sections 2.7 and 4.2 of the
 * concept): one card for the asset and for what was sent with it, which shows
 * the asset that is there as far as the device holds it, and three ways out.
 */

afterEach(afterEachSiteTest)

const at = new Date('2026-10-06T07:30:00Z')

function conflict(part: Partial<Omit<SyncConflict, 'id'>> & { readonly id: string }): SyncConflict {
  return {
    tenantId: 't-nord',
    operationId: `op-${part.id}`,
    entity: 'assets',
    recordId: 'a-new',
    reason: 'record_missing',
    fields: ['assetId'],
    wanted: {},
    seen: {},
    found: {},
    deviceId: 'phone',
    recordedAt: at,
    resolvedAt: null,
    createdAt: at,
    updatedAt: at,
    ...part,
  } as SyncConflict
}

/** An elevator entered on site with the serial number of the one in the boiler room. */
const aboutTheAsset = conflict({
  id: 'k-asset',
  reason: 'changed_elsewhere',
  fields: ['serialNumber'],
  wanted: {
    buildingId: 'b-house',
    roomId: 'r-store',
    kind: 'probe.elevator',
    name: 'Aufzug Lager',
    manufacturer: null,
    serialNumber: 'bt-750-22-0193',
    yearBuilt: 2024,
    values: '{"stops":2}',
    distinctFrom: '[]',
  },
})
const aboutThePhoto = conflict({
  id: 'k-photo',
  entity: 'attachments',
  recordId: 'd-plate',
  wanted: { title: 'Typenschild', propertyId: 'p-school', assetId: 'a-new' },
})
const aboutTheFile = conflict({
  id: 'k-file',
  entity: 'attachment_versions',
  recordId: 'v-plate',
  fields: ['attachmentId'],
  wanted: {
    attachmentId: 'd-plate',
    sha256: 'a'.repeat(64),
    fileName: 'typenschild.jpg',
    mediaType: 'image/jpeg',
    sizeBytes: 1200,
  },
})
const aboutTheLabel = conflict({
  id: 'k-label',
  entity: 'labels',
  recordId: fromASheet.id,
  wanted: { assetId: 'a-new' },
})
/** A conflict that has nothing to do with it: two devices named the same room. */
const aboutARoom = conflict({
  id: 'k-room',
  entity: 'rooms',
  recordId: 'r-store',
  reason: 'changed_elsewhere',
  fields: ['name'],
  wanted: { name: 'Lager Ost' },
  seen: { name: 'Lager' },
  found: { name: 'Lager West' },
})

const every = [aboutTheAsset, aboutThePhoto, aboutTheFile, aboutTheLabel, aboutARoom]

/**
 * The school with the conflicts of one asset entered twice, on the screen of
 * the conflicts. The server hands out the conflicts that are open and
 * remembers the ones that were closed.
 */
async function deciding(
  open: readonly SyncConflict[] = every,
  answers: Readonly<Record<string, unknown>> = {},
) {
  const closed: string[] = []
  let waiting = [...open]
  const server = Object.assign(schoolServer(), {
    conflicts: () => Promise.resolve(waiting),
    resolve: (id: string) => {
      closed.push(id)
      waiting = waiting.filter((each) => each.id !== id)

      return Promise.resolve()
    },
  })
  const site = await mountSite('/konflikte', {
    server,
    rights: ['asset.read', 'asset.record', 'document.record'],
    answers,
  })

  return { ...site, closed, stillOpen: () => waiting.map((each) => each.id) }
}

describe('what a possible duplicate is among the conflicts', () => {
  it('is an asset that was to be made and was refused over its serial number or its mark', () => {
    expect(isDuplicateConflict(aboutTheAsset)).toBe(true)
    expect(isDuplicateConflict({ ...aboutTheAsset, fields: ['mark'] })).toBe(true)
    // Two devices that corrected the serial number of one asset name no building.
    expect(isDuplicateConflict({ ...aboutTheAsset, wanted: { serialNumber: 'BT-1' } })).toBe(false)
    expect(isDuplicateConflict({ ...aboutTheAsset, fields: ['name'] })).toBe(false)
    expect(isDuplicateConflict({ ...aboutTheAsset, reason: 'record_missing' })).toBe(false)
    expect(isDuplicateConflict(aboutARoom)).toBe(false)
  })

  it('takes with it what hangs on the asset that was not made, and nothing else', () => {
    expect(followersOf(aboutTheAsset, every).map((each) => each.id)).toEqual([
      'k-photo',
      'k-label',
      'k-file',
    ])
    // A photo of another asset, and the file of another document, stay where they are.
    expect(
      followersOf(aboutTheAsset, [
        { ...aboutThePhoto, wanted: { ...aboutThePhoto.wanted, assetId: 'a-other' } },
        aboutTheFile,
      ]),
    ).toEqual([])
  })
})

describe('the page of an asset that was not made', () => {
  it('says that it waits for a decision, and leads to the conflicts', async () => {
    const waiting = [aboutTheAsset]
    const server = Object.assign(schoolServer(), {
      conflicts: () => Promise.resolve(waiting),
    })

    await mountSite('/anlagen/a-new', { server, rights: ['asset.read'] })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Wartet auf eine Entscheidung' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zu den Konflikten' }).getAttribute('href')).toBe(
      '/m/konflikte',
    )
  })
})

describe('the card of a possible duplicate', () => {
  it('shows the asset that is there and what waits with the new one, in one card', async () => {
    await deciding()

    const card = screen.getByRole('region', { name: 'Aufzug Lager' })

    expect(
      within(card).getByText(
        'Mögliche Dublette: gleiche Seriennummer wie eine Anlage, die es schon gibt.',
      ),
    ).toBeTruthy()
    expect(
      within(card).getByRole('link', { name: 'AN-00057 Aufzug Heizraum' }).getAttribute('href'),
    ).toBe('/m/anlagen/a-heater')
    expect(within(card).getByText('Schulhaus, E.14 Heizraum')).toBeTruthy()
    expect(
      within(card).getByText(
        'Mit dieser Aufnahme warten 1 Foto und 1 Etikett. Sie gehen mit der Entscheidung.',
      ),
    ).toBeTruthy()
    // What hangs on the asset has no card; a conflict about something else keeps the foundation's.
    expect(screen.getAllByRole('heading', { level: 2 }).map((head) => head.textContent)).toEqual([
      'Aufzug Lager',
      'E.15',
    ])
    expect(screen.getAllByRole('button', { name: 'Fassung vom Gerät übernehmen' })).toHaveLength(1)
  })

  it('hangs the photo and the label on the asset that is there with "Ist dieselbe Anlage", and makes no second one', async () => {
    const { server, asked, closed, stillOpen } = await deciding()

    fireEvent.click(screen.getByRole('button', { name: 'Ist dieselbe Anlage' }))

    await waitFor(() => {
      expect([...closed].sort()).toEqual(['k-asset', 'k-file', 'k-label', 'k-photo'])
    })

    const sent = queued(server)

    // The asset in the boiler room has its label already: the sticker of the
    // new one is given to nothing and stays free.
    expect(sent.map(({ entity, kind }) => `${entity} ${kind}`)).toEqual([
      'attachments create',
      'attachment_versions create',
    ])
    expect(sent[0]?.values).toMatchObject({
      title: 'Typenschild',
      propertyId: 'p-school',
      assetId: heater.id,
    })
    expect(sent[1]?.values).toMatchObject({
      attachmentId: server.operations()[0]?.recordId,
      sha256: 'a'.repeat(64),
      fileName: 'typenschild.jpg',
    })
    expect(asked.filter((request) => request.method === 'POST')).toEqual([])
    // The conflict about the room is still to decide.
    expect(stillOpen()).toEqual(['k-room'])
  })

  it('gives the label to the asset that is there, where that one has none, and says of one thing that it goes', async () => {
    // The lightning rod carries the number of the new asset, and no label yet.
    const about = {
      ...aboutTheAsset,
      wanted: { ...aboutTheAsset.wanted, serialNumber: 'rod-7' },
    }
    const server = schoolServer()

    server.put('assets', { ...rod, serialNumber: 'ROD-7' })

    const closed: string[] = []
    let waiting = [about, aboutTheLabel]
    const deciding = Object.assign(server, {
      conflicts: () => Promise.resolve(waiting),
      resolve: (id: string) => {
        closed.push(id)
        waiting = waiting.filter((each) => each.id !== id)

        return Promise.resolve()
      },
    })

    await mountSite('/konflikte', { server: deciding, rights: ['asset.read', 'asset.record'] })

    expect(
      screen.getByText('Mit dieser Aufnahme wartet 1 Etikett. Es geht mit der Entscheidung.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ist dieselbe Anlage' }))

    await waitFor(() => {
      expect([...closed].sort()).toEqual(['k-asset', 'k-label'])
    })
    expect(queued(server)).toEqual([
      { entity: 'labels', kind: 'update', values: { assetId: rod.id } },
    ])
    expect(server.operations()[0]?.recordId).toBe(fromASheet.id)
  })

  it('makes the asset at its route with "Trotzdem anlegen", and hangs what was sent with it on the new one', async () => {
    const { server, asked, closed } = await deciding(every, {
      'POST /buildings/b-house/assets': { id: 'a-made' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem anlegen' }))

    await waitFor(() => {
      expect([...closed].sort()).toEqual(['k-asset', 'k-file', 'k-label', 'k-photo'])
    })
    expect(asked.filter((request) => request.method === 'POST')).toEqual([
      {
        method: 'POST',
        path: '/buildings/b-house/assets',
        // As the route takes an asset: its values as an object, its room, and
        // neither the building of the address nor what it was held against.
        body: {
          kind: 'probe.elevator',
          name: 'Aufzug Lager',
          serialNumber: 'bt-750-22-0193',
          yearBuilt: 2024,
          values: { stops: 2 },
          roomId: 'r-store',
        },
      },
    ])

    const sent = queued(server)

    expect(sent.map(({ entity, kind }) => `${entity} ${kind}`)).toEqual([
      'attachments create',
      'attachment_versions create',
      'labels update',
    ])
    expect(sent[0]?.values).toMatchObject({ propertyId: 'p-school', assetId: 'a-made' })
    expect(sent[2]?.values).toEqual({ assetId: 'a-made' })
    expect(server.operations()[2]?.recordId).toBe(fromASheet.id)
  })

  it('closes nothing where the route refuses the asset, and says why', async () => {
    const { server, closed } = await deciding()

    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem anlegen' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(closed).toEqual([])
    expect(queued(server)).toEqual([])
  })

  it('says only that there is one where the device does not hold it, and lets all of it go with "Nicht anlegen"', async () => {
    const elsewhere = {
      ...aboutTheAsset,
      wanted: { ...aboutTheAsset.wanted, serialNumber: 'SN-IN-ANOTHER-AREA' },
    }
    const { server, asked, closed } = await deciding([elsewhere, aboutThePhoto, aboutTheFile])
    const card = screen.getByRole('region', { name: 'Aufzug Lager' })

    expect(
      within(card).getByText(
        'Mögliche Dublette: gleiche Seriennummer wie eine Anlage außerhalb Ihrer Bereiche. Dieses Gerät zeigt sie nicht.',
      ),
    ).toBeTruthy()
    expect(within(card).queryByRole('link')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Ist dieselbe Anlage' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Trotzdem anlegen' })).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: 'Nicht anlegen' }))

    await waitFor(() => {
      expect([...closed].sort()).toEqual(['k-asset', 'k-file', 'k-photo'])
    })
    expect(queued(server)).toEqual([])
    expect(asked.filter((request) => request.method === 'POST')).toEqual([])
  })
})
