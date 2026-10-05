import { dayInGermany } from '../today.js'
import type { PreviewArea } from './preview-database.js'

/**
 * The sample operator of the preview: two areas, two properties in each, with
 * buildings, floors and rooms, and assets of the kinds of the probe package,
 * a main water meter with its sub meters among them (#29). One property has
 * two buildings and a note, so that the list and the page of a property show
 * both (#85), and the people to talk to there: one with everything known
 * about them and one without an address. At another property only a name is
 * known, and two have nobody entered. The school house has the times it is
 * closed (#86): the holidays that come next, counted from the year the
 * preview is started in, so that they lie ahead in every year.
 *
 * Written for the preview and taken from nowhere: the names, streets and
 * places are made up, the postal codes and the phone numbers begin with 0000,
 * which no place and no line in Germany has, and the addresses end in
 * `.example`. Nothing here is a template, a building, an asset or a person of
 * a real operator.
 *
 * Planted through the routes the interface uses, as the Leitung, so that a
 * route which changes its mind about a field breaks the test of the preview
 * and not its next start.
 */

interface SampleRoom {
  readonly number: string
  readonly name: string
  readonly use?: string
}

interface SampleFloor {
  readonly name: string
  readonly level: number
  readonly rooms: readonly SampleRoom[]
}

interface SampleAsset {
  readonly kind: 'probe.elevator' | 'probe.water_meter'
  readonly name: string
  readonly manufacturer?: string
  readonly yearBuilt?: number
  readonly values: Readonly<Record<string, unknown>>
  readonly meterNumber?: string
  /** The number of the room it stands in, if it stands in one. */
  readonly room?: string
  readonly components?: readonly SampleAsset[]
}

interface SampleBuilding {
  readonly name: string
  readonly shortCode: string
  readonly kinds: readonly string[]
  readonly yearBuilt: number
  readonly closures?: readonly SampleClosure[]
  readonly floors: readonly SampleFloor[]
  readonly assets: readonly SampleAsset[]
}

/** A time a building is closed, from a day to a day. */
export interface SampleClosure {
  readonly startsOn: string
  readonly endsOn: string
  readonly reason?: string
}

/** The year the preview is started in, in Germany. */
const thisYear = Number(dayInGermany().slice(0, 4))

/** The holidays of the school that come next: over the turn of the year, and the summer after it. */
export const schoolHolidays: readonly SampleClosure[] = [
  {
    startsOn: `${String(thisYear)}-12-24`,
    endsOn: `${String(thisYear + 1)}-01-06`,
    reason: 'Weihnachtsferien',
  },
  {
    startsOn: `${String(thisYear + 1)}-07-27`,
    endsOn: `${String(thisYear + 1)}-09-06`,
    reason: 'Sommerferien',
  },
]

/** Somebody to talk to at a property. */
export interface SampleContact {
  readonly givenName?: string
  readonly familyName: string
  readonly role?: string
  readonly phone?: string
  readonly email?: string
}

interface SampleProperty {
  readonly area: PreviewArea
  readonly name: string
  readonly street: string
  readonly postalCode: string
  readonly city: string
  /** What somebody has to know before going there, in the lines it was typed in. */
  readonly note?: string
  readonly contacts?: readonly SampleContact[]
  readonly buildings: readonly SampleBuilding[]
}

const waterMeter = (
  name: string,
  meterNumber: string,
  room: string,
  components: readonly SampleAsset[] = [],
): SampleAsset => ({
  kind: 'probe.water_meter',
  name,
  values: { hot_water: false, calibration_year: 2021 },
  meterNumber,
  room,
  components,
})

export const sampleProperties: readonly SampleProperty[] = [
  {
    area: 'Nord',
    name: 'Verwaltung Am Probehang',
    street: 'Am Probehang 4',
    postalCode: '00001',
    city: 'Beispielstadt',
    buildings: [
      {
        name: 'Haus A',
        shortCode: 'A',
        kinds: ['office'],
        yearBuilt: 1998,
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: '0.01', name: 'Empfang' },
              { number: '0.12', name: 'Technikraum', use: 'Haustechnik' },
            ],
          },
          {
            name: '1. Obergeschoss',
            level: 1,
            rooms: [
              { number: '1.05', name: 'Besprechung' },
              { number: '1.20', name: 'Teeküche' },
            ],
          },
        ],
        assets: [
          {
            kind: 'probe.elevator',
            name: 'Aufzug Haus A',
            manufacturer: 'Beispiel Aufzüge',
            yearBuilt: 1998,
            values: { firefighters_lift: false, stops: 2 },
          },
          waterMeter('Hauptwasserzähler Haus A', 'WZ-1001', '0.12', [
            waterMeter('Unterzähler Teeküche', 'WZ-1002', '1.20'),
          ]),
        ],
      },
    ],
  },
  {
    area: 'Nord',
    name: 'Werkhof Nord',
    street: 'Lagerweg 12',
    postalCode: '00002',
    city: 'Beispielstadt',
    contacts: [{ familyName: 'Albers' }],
    buildings: [
      {
        name: 'Halle 1',
        shortCode: 'H1',
        kinds: ['commercial'],
        yearBuilt: 2009,
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: 'E.01', name: 'Werkstatt' },
              { number: 'E.02', name: 'Lager' },
            ],
          },
        ],
        assets: [waterMeter('Wasserzähler Werkstatt', 'WZ-2001', 'E.01')],
      },
    ],
  },
  {
    area: 'Süd',
    name: 'Schulzentrum Am Lindenhain',
    street: 'Am Lindenhain 7',
    postalCode: '00003',
    city: 'Musterhausen',
    note: 'Zufahrt über den Hof an der Lindenstraße.\nSchlüssel beim Hausmeister, Raum E.10.',
    contacts: [
      {
        givenName: 'Klaus',
        familyName: 'Becker',
        role: 'Hausmeister',
        phone: '0000 4471',
        email: 'hausmeister@schulzentrum.example',
      },
      // A title is typed with the given name: a contact has no field of its own for one.
      { givenName: 'Dr. Ines', familyName: 'Hartmann', role: 'Schulleitung', phone: '0000 4400' },
    ],
    buildings: [
      {
        name: 'Schulhaus',
        shortCode: 'S',
        kinds: ['school'],
        yearBuilt: 1975,
        closures: schoolHolidays,
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: 'E.10', name: 'Hausmeister' },
              { number: 'E.14', name: 'Heizraum', use: 'Haustechnik' },
            ],
          },
          {
            name: '1. Obergeschoss',
            level: 1,
            rooms: [{ number: '1.03', name: 'Klassenraum 5a' }],
          },
        ],
        assets: [
          {
            kind: 'probe.elevator',
            name: 'Aufzug Schulhaus',
            yearBuilt: 2012,
            values: { firefighters_lift: false, stops: 2 },
          },
          waterMeter('Hauptwasserzähler Schulhaus', 'WZ-3001', 'E.14', [
            waterMeter('Unterzähler Sporthalle', 'WZ-3002', 'E.14'),
          ]),
        ],
      },
      {
        name: 'Sporthalle',
        shortCode: 'SH',
        kinds: ['school', 'assembly'],
        yearBuilt: 1982,
        floors: [
          {
            name: 'Erdgeschoss',
            level: 0,
            rooms: [
              { number: 'H.01', name: 'Halle' },
              { number: 'H.02', name: 'Geräteraum' },
            ],
          },
        ],
        assets: [],
      },
    ],
  },
  {
    area: 'Süd',
    name: 'Wohnanlage Birkenweg',
    street: 'Birkenweg 2',
    postalCode: '00004',
    city: 'Musterhausen',
    buildings: [
      {
        name: 'Haus 2',
        shortCode: '2',
        kinds: ['residential'],
        yearBuilt: 1987,
        floors: [
          {
            name: 'Keller',
            level: -1,
            rooms: [{ number: 'K.01', name: 'Hausanschlussraum', use: 'Haustechnik' }],
          },
          { name: 'Erdgeschoss', level: 0, rooms: [{ number: 'E.01', name: 'Treppenhaus' }] },
        ],
        assets: [
          {
            kind: 'probe.elevator',
            name: 'Aufzug Haus 2',
            values: { firefighters_lift: false, stops: 5 },
          },
          waterMeter('Hauptwasserzähler Haus 2', 'WZ-4001', 'K.01'),
        ],
      },
    ],
  },
]

/** The name the sample operator goes by, so that nobody takes it for a real one. */
export const sampleOperatorName = 'Liegenschaften Beispielstadt (Vorschau)'

/** A request of the planting, which fails with the answer of the server when it is refused. */
async function send(address: string, path: string, body: unknown): Promise<{ id: string }> {
  const response = await fetch(`${address}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
  }

  return (await response.json()) as { id: string }
}

async function plantAsset(
  address: string,
  path: string,
  asset: SampleAsset,
  rooms: ReadonlyMap<string, string>,
): Promise<void> {
  const { components = [], room, ...fields } = asset
  const roomId = room === undefined ? undefined : rooms.get(room)
  const created = await send(address, path, {
    ...fields,
    ...(asset.meterNumber === undefined ? {} : { meterUnit: 'cubic_metres' }),
    ...(roomId === undefined ? {} : { roomId }),
  })

  for (const component of components) {
    await plantAsset(address, `/assets/${created.id}/components`, component, rooms)
  }
}

/**
 * Plants the sample operator through the routes of the preview at `address`,
 * as whoever that preview answers as, which has to be somebody who sees every
 * area and keeps the places: the Leitung.
 */
export async function plantSampleData(
  address: string,
  areas: ReadonlyMap<PreviewArea, string>,
): Promise<void> {
  for (const property of sampleProperties) {
    const { buildings, area, contacts = [], ...fields } = property
    const created = await send(address, '/properties', {
      ...fields,
      federalState: 'DE-BW',
      areaId: areas.get(area),
    })

    for (const contact of contacts) {
      await send(address, '/contacts', { ...contact, propertyId: created.id })
    }

    for (const building of buildings) {
      const { floors, assets, closures = [], ...buildingFields } = building
      const madeBuilding = await send(
        address,
        `/properties/${created.id}/buildings`,
        buildingFields,
      )
      const rooms = new Map<string, string>()

      for (const closure of closures) {
        await send(address, `/buildings/${madeBuilding.id}/closures`, closure)
      }

      for (const floor of floors) {
        const madeFloor = await send(address, `/buildings/${madeBuilding.id}/floors`, {
          name: floor.name,
          level: floor.level,
        })

        for (const room of floor.rooms) {
          const madeRoom = await send(address, `/floors/${madeFloor.id}/rooms`, room)
          rooms.set(room.number, madeRoom.id)
        }
      }

      for (const asset of assets) {
        await plantAsset(address, `/buildings/${madeBuilding.id}/assets`, asset, rooms)
      }
    }
  }
}
