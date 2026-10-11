import type { RecordState, SearchAnswer, SearchKind } from '@opengewerk/haustechnik-domain'
import { RequestRefused, type SyncClient } from '@opengewerk/platform-web/sync'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { hitLines, searchDevice, searchFor } from './search.js'

/**
 * The search on the device and the way to the server (#125): without a
 * network the device searches what it holds the way the server searches, the
 * same texts, the closest first, at most five of a kind, a kind only for
 * whoever may read it; with one the server is asked, and only a missing
 * network sends the search back to the device.
 */

/** A device holding these rows, and with or without a network. */
function deviceWith(
  rows: Readonly<Record<string, readonly RecordState[]>>,
  online = false,
): SyncClient {
  return {
    list: (entity: string) => rows[entity] ?? [],
    get: (entity: string, id: string) =>
      (rows[entity] ?? []).find((row) => row['id'] === id) ?? null,
    status: () => ({ online }),
  } as unknown as SyncClient
}

const everything = (_kind: SearchKind) => true

const places: Readonly<Record<string, readonly RecordState[]>> = {
  properties: [
    {
      id: 'p1',
      name: 'Schulzentrum Am Lindenhain',
      street: 'Lindenstraße 4',
      postalCode: '00001',
      city: 'Beispielstadt',
      deletedAt: null,
    },
  ],
  buildings: [
    { id: 'b1', propertyId: 'p1', name: 'Schulhaus', shortCode: 'SH', deletedAt: null },
    { id: 'b2', propertyId: 'p1', name: 'Mensa', shortCode: null, deletedAt: null },
  ],
  floors: [{ id: 'f1', buildingId: 'b1', propertyId: 'p1', name: 'Erdgeschoss', deletedAt: null }],
  rooms: [
    {
      id: 'r1',
      floorId: 'f1',
      buildingId: 'b1',
      propertyId: 'p1',
      number: 'E.14',
      name: 'Heizraum',
      deletedAt: null,
    },
  ],
  assets: [
    {
      id: 'a1',
      buildingId: 'b1',
      roomId: 'r1',
      number: 'AN-00058',
      name: 'Heizkessel',
      mark: 'HZ-SH-01',
      serialNumber: 'SN-4711',
      meterNumber: null,
      deletedAt: null,
    },
    {
      id: 'a2',
      buildingId: 'b2',
      roomId: null,
      number: 'AN-00102',
      name: 'Wärmezähler Mensa',
      mark: null,
      serialNumber: null,
      meterNumber: '7720431',
      deletedAt: null,
    },
    // Removed on this device: found by nobody.
    {
      id: 'a3',
      buildingId: 'b1',
      roomId: null,
      number: 'AN-00059',
      name: 'Heizkessel alt',
      mark: null,
      serialNumber: null,
      meterNumber: null,
      deletedAt: '2026-10-01T08:00:00.000Z',
    },
  ],
  activities: [
    {
      id: 'v1',
      propertyId: 'p1',
      buildingId: 'b2',
      kind: 'work_order',
      title: 'Heizkessel Mensa entlüften',
      status: 'open',
      deletedAt: null,
    },
    {
      id: 'v2',
      propertyId: 'p1',
      buildingId: null,
      kind: 'inspection',
      title: 'Prüfung der Heizungsanlage',
      status: 'started',
      deletedAt: null,
    },
  ],
  work_orders: [{ id: 'w1', activityId: 'v1', number: 'AU-2026-0028', deletedAt: null }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the search on the device', () => {
  it('finds each kind by the texts the server searches, in the order of the kinds', () => {
    const answer = searchDevice(deviceWith(places), 'heiz', everything)

    expect(answer.hits.map((hit) => `${hit.kind} ${hit.id}`)).toEqual([
      'room r1',
      'asset a1',
      'activity v1',
      'activity v2',
    ])
    expect(answer.more).toEqual([])
    expect(answer.hits[1]).toEqual({
      kind: 'asset',
      id: 'a1',
      number: 'AN-00058',
      name: 'Heizkessel',
      mark: { field: 'mark', value: 'HZ-SH-01' },
      building: 'Schulhaus',
      room: 'E.14 Heizraum',
    })
    // By the short code, the number of a work order, a serial and a meter number, a number and a name in one line.
    expect(searchDevice(deviceWith(places), 'sh', everything).hits.map((hit) => hit.id)).toContain(
      'b1',
    )
    expect(searchDevice(deviceWith(places), 'au-2026-0028', everything).hits).toEqual([
      {
        kind: 'activity',
        id: 'v1',
        activityKind: 'work_order',
        number: 'AU-2026-0028',
        title: 'Heizkessel Mensa entlüften',
        status: 'open',
        place: 'Mensa',
      },
    ])
    expect(searchDevice(deviceWith(places), '4711', everything).hits).toEqual([
      expect.objectContaining({ id: 'a1', mark: { field: 'serialNumber', value: 'SN-4711' } }),
    ])
    expect(searchDevice(deviceWith(places), '7720431', everything).hits).toEqual([
      expect.objectContaining({ id: 'a2', mark: { field: 'meterNumber', value: '7720431' } }),
    ])
    expect(searchDevice(deviceWith(places), 'E.14 Heizraum', everything).hits).toEqual([
      expect.objectContaining({ kind: 'room', id: 'r1' }),
    ])
  })

  it('finds an asset by its number and no other', () => {
    expect(
      searchDevice(deviceWith(places), 'AN-00058', everything).hits.map((hit) => hit.id),
    ).toEqual(['a1'])
  })

  it('finds nothing the device holds as removed', () => {
    expect(searchDevice(deviceWith(places), 'AN-00059', everything).hits).toEqual([])
  })

  it('finds a kind only for whoever may read it, and never an evidence', () => {
    const placesOnly = (kind: SearchKind) => ['property', 'building', 'room'].includes(kind)

    expect(
      searchDevice(deviceWith(places), 'heiz', placesOnly).hits.map((hit) => hit.kind),
    ).toEqual(['room'])
    expect(
      searchDevice(
        deviceWith({ ...places, evidence: [{ id: 'e1', number: 'NW-2026-00001' }] }),
        'NW-2026',
        everything,
      ).hits,
    ).toEqual([])
  })

  it('puts the closest first and holds at most five of a kind, saying that there are more', () => {
    const pumps = [
      'Abwasserpumpe',
      'Pumpe Ost',
      'Pumpe',
      'Zirkulationspumpe 1',
      'Zirkulationspumpe 2',
      'Zirkulationspumpe 3',
    ]
    const assets = pumps.map((name, index) => ({
      id: `p${String(index)}`,
      buildingId: 'b1',
      roomId: null,
      number: `AN-0010${String(index)}`,
      name,
      mark: null,
      serialNumber: null,
      meterNumber: null,
      deletedAt: null,
    }))
    const answer = searchDevice(deviceWith({ ...places, assets }), 'pumpe', everything)

    expect(answer.hits.map((hit) => (hit.kind === 'asset' ? hit.name : hit.kind))).toEqual([
      'Pumpe',
      'Pumpe Ost',
      'Abwasserpumpe',
      'Zirkulationspumpe 1',
      'Zirkulationspumpe 2',
    ])
    expect(answer.more).toEqual(['asset'])
  })
})

describe('where the search is asked', () => {
  const fromServer: SearchAnswer = {
    hits: [
      {
        kind: 'evidence',
        id: 'e1',
        number: 'NW-2026-00012',
        title: 'Prüfung der Sicherheitsbeleuchtung',
        performedOn: '2026-09-30',
        place: 'Schulhaus',
      },
    ],
    more: [],
  }

  function serving(answer: () => Promise<Response>): string[] {
    const asked: string[] = []

    vi.stubGlobal('fetch', (path: string) => {
      asked.push(path)

      return answer()
    })

    return asked
  }

  it('asks the server with a network', async () => {
    const asked = serving(() =>
      Promise.resolve(new Response(JSON.stringify(fromServer), { status: 200 })),
    )
    const searched = await searchFor(
      deviceWith(places, true),
      'NW 2026',
      everything,
      new AbortController().signal,
    )

    expect(asked).toEqual(['/search?q=NW+2026'])
    expect(searched).toEqual({ answer: fromServer, onDevice: false })
  })

  it('searches the device without a network, and asks nobody', async () => {
    const asked = serving(() =>
      Promise.reject(new Error('Dieser Test hat keine Anfrage erwartet.')),
    )
    const searched = await searchFor(
      deviceWith(places, false),
      'heiz',
      everything,
      new AbortController().signal,
    )

    expect(asked).toEqual([])
    expect(searched.onDevice).toBe(true)
    expect(searched.answer.hits.map((hit) => hit.id)).toEqual(['r1', 'a1', 'v1', 'v2'])
  })

  it('searches the device when the server cannot be reached', async () => {
    serving(() => Promise.reject(new TypeError('Failed to fetch')))

    const searched = await searchFor(
      deviceWith(places, true),
      'heiz',
      everything,
      new AbortController().signal,
    )

    expect(searched.onDevice).toBe(true)
    expect(searched.answer.hits).toHaveLength(4)
  })

  it('passes a refusal of the server on, with its sentence', async () => {
    serving(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Gesucht wird nach höchstens 100 Zeichen.' }), {
          status: 400,
        }),
      ),
    )

    await expect(
      searchFor(deviceWith(places, true), 'heiz', everything, new AbortController().signal),
    ).rejects.toEqual(expect.any(RequestRefused))
  })
})

describe('the lines of a hit', () => {
  it('say what it is and where, as the boards do', () => {
    const answer = searchDevice(deviceWith(places), 'heiz', everything)

    expect(answer.hits.map(hitLines)).toEqual([
      { title: 'E.14 Heizraum', detail: 'Schulzentrum Am Lindenhain, Schulhaus, Erdgeschoss' },
      { title: 'AN-00058 Heizkessel', detail: 'Kennzeichen HZ-SH-01 · Schulhaus, E.14 Heizraum' },
      { title: 'AU-2026-0028 Heizkessel Mensa entlüften', detail: 'Auftrag · Mensa · offen' },
      {
        title: 'Prüfung der Heizungsanlage',
        detail: 'Prüfung · Schulzentrum Am Lindenhain · begonnen',
      },
    ])
    expect(
      hitLines({
        kind: 'evidence',
        id: 'e1',
        number: 'NW-2026-00012',
        title: 'Prüfung der Sicherheitsbeleuchtung',
        performedOn: '2026-09-30',
        place: 'Schulhaus',
      }),
    ).toEqual({
      title: 'NW-2026-00012 Prüfung der Sicherheitsbeleuchtung',
      detail: 'Nachweis vom 30.09.2026 · Schulhaus',
    })
    expect(
      hitLines({
        kind: 'building',
        id: 'b1',
        name: 'Schulhaus',
        shortCode: 'SH',
        property: 'Schulzentrum Am Lindenhain',
      }),
    ).toEqual({ title: 'Schulhaus', detail: 'Kürzel SH · Schulzentrum Am Lindenhain' })
  })
})
