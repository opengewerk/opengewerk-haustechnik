import { dayInGermany } from '../today.js'
import type { PreviewArea } from './preview-database.js'

/**
 * The sample operator of the preview: two areas, two properties in each, with
 * buildings, floors and rooms, and assets of the kinds of the probe package,
 * a main water meter with its sub meters among them (#29), and one asset of a
 * general kind, a ventilation unit no package describes yet (#61). One property has
 * two buildings and a note, so that the list and the page of a property show
 * both (#85), and the people to talk to there: one with everything known
 * about them and one without an address. At another property only a name is
 * known, and two have nobody entered. The school house has the times it is
 * closed (#86): the holidays that come next, counted from the year the
 * preview is started in, so that they lie ahead in every year. Every asset is
 * in service; one sub meter is out of service since the first day of the
 * year. The main meter of the school house supplies the whole building, and
 * its sub meter the gym, which it does not stand in, so that the page of a
 * room shows what supplies it from elsewhere. Some assets have duties, met a
 * while ago, long ago or never, one rests with its asset and one elevator has
 * an open defect, so that the register of assets and the file of an asset
 * show every condition (#87). Beside the colleagues the
 * preview admits, one person is asked to join and one stands in for another
 * from next week on, so that "Zugänge" shows an invitation and a substitution
 * (#84).
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
  /** Duties that hang on the room itself, of the operator's own. */
  readonly duties?: readonly SampleDuty[]
}

interface SampleFloor {
  readonly name: string
  readonly level: number
  readonly rooms: readonly SampleRoom[]
}

interface SampleAsset {
  readonly kind:
    'probe.elevator' | 'probe.water_meter' | 'allgemein.ventilation_and_air_conditioning'
  readonly name: string
  readonly manufacturer?: string
  readonly model?: string
  /** With a serial number and a mark an asset can be found again as a possible duplicate. */
  readonly serialNumber?: string
  readonly mark?: string
  readonly yearBuilt?: number
  readonly values: Readonly<Record<string, unknown>>
  readonly meterNumber?: string
  /** The number of the room it stands in, if it stands in one. */
  readonly room?: string
  readonly components?: readonly SampleAsset[]
  /** The state it is in from a day on, after being in service from the start. */
  readonly lifecycle?: readonly SampleState[]
  /** The buildings of its property it supplies, by name: its own as a whole, or one it does not stand in. */
  readonly supplies?: readonly string[]
  readonly duties?: readonly SampleDuty[]
  /** A defect somebody found at it and nobody has set right. */
  readonly defect?: string
}

/**
 * A duty at a sample asset or a sample room: confirmed from the catalogue by
 * the key of its kind, or one of the operator's own, after the instructions
 * of the maker unless it names another basis, with the days it was met on,
 * counted back from the day the preview starts.
 *
 * Who answers for it is one of the colleagues of the preview
 * (`previewColleagues`), by the id of their account; a duty without one is
 * what the register points out.
 */
export interface SampleDuty {
  readonly kind?: 'probe.elevator_main_test'
  readonly label?: string
  readonly basis?: 'manufacturer' | 'own_decision'
  readonly sourceNote?: string
  readonly intervalMonths: number
  readonly metDaysAgo?: readonly number[]
  readonly responsible?: PreviewColleagueId
  readonly performer?: 'own_staff' | 'contractor'
  readonly performerNote?: string
  /** It ended this many days ago, and calls for nothing since. */
  readonly endedDaysAgo?: number
  /**
   * Evidence beside what met it, so that the page of a duty shows each thing
   * an evidence can mean for the appointment: a test that failed, an evidence
   * declared invalid, and one a correction replaced.
   */
  readonly alsoRecorded?: readonly SampleEvidence[]
}

/** An evidence of a sample duty that does not simply count. */
export interface SampleEvidence {
  readonly daysAgo: number
  readonly result?: 'failed'
  /** Declared invalid, for this reason. */
  readonly voidedBecause?: string
  /** A correction of the evidence of that many days ago, which it replaces. */
  readonly correctsDaysAgo?: number
}

type PreviewColleagueId = 'preview-albrecht' | 'preview-lindner' | 'preview-roth' | 'preview-yilmaz'

/** Who performs a duty: the operator's own people, or a contractor by name. */
const ownStaff = { performer: 'own_staff' } as const
const contractor = (performerNote: string) => ({ performer: 'contractor', performerNote }) as const

/** A state of a life cycle, from a day on. */
export interface SampleState {
  readonly state: 'in_service' | 'out_of_service'
  readonly validFrom: string
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

/** Every sample asset is in service from this day on. */
export const inServiceSince = '2020-01-01'

/** Out of service since the first day of the year the preview is started in. */
export const outOfServiceThisYear: readonly SampleState[] = [
  { state: 'out_of_service', validFrom: `${String(thisYear)}-01-01` },
]

/** The main test of an elevator from the catalogue, every two years, met on these days. */
const mainTest = (...metDaysAgo: number[]): SampleDuty => ({
  kind: 'probe.elevator_main_test',
  intervalMonths: 24,
  metDaysAgo,
})

/** A duty of the operator's own, every year, met on these days. */
const yearly = (label: string, ...metDaysAgo: number[]): SampleDuty => ({
  label,
  intervalMonths: 12,
  metDaysAgo,
})

const waterMeter = (
  name: string,
  meterNumber: string,
  room: string,
  components: readonly SampleAsset[] = [],
  further: Pick<SampleAsset, 'lifecycle' | 'supplies' | 'duties'> = {},
): SampleAsset => ({
  kind: 'probe.water_meter',
  name,
  values: { hot_water: false, calibration_year: 2021 },
  meterNumber,
  room,
  components,
  ...further,
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
            // In order: both met, the next one falls due in months.
            duties: [
              {
                ...mainTest(200),
                responsible: 'preview-lindner',
                ...contractor('Prüfdienst Beispiel GmbH'),
              },
              {
                ...yearly('Wartung des Aufzugs', 405, 40),
                responsible: 'preview-lindner',
                ...contractor('Beispiel Aufzüge, Kundendienst'),
                // What the last maintenance counts from stays the one of
                // forty days ago: none of these three counts.
                alsoRecorded: [
                  { daysAgo: 404, correctsDaysAgo: 405 },
                  { daysAgo: 25, result: 'failed' },
                  {
                    daysAgo: 12,
                    voidedBecause: 'Der Bericht gehört zum Aufzug im Nachbarhaus.',
                  },
                ],
              },
            ],
          },
          waterMeter(
            'Hauptwasserzähler Haus A',
            'WZ-1001',
            '0.12',
            [
              // Due: a year is over in two weeks.
              waterMeter('Unterzähler Teeküche', 'WZ-1002', '1.20', [], {
                duties: [
                  {
                    ...yearly('Sichtprüfung der Zähleranlage', 350),
                    responsible: 'preview-lindner',
                    ...ownStaff,
                  },
                ],
              }),
            ],
            // Overdue: the year was over a month ago.
            {
              duties: [
                {
                  ...yearly('Sichtprüfung der Zähleranlage', 400),
                  responsible: 'preview-albrecht',
                  ...ownStaff,
                },
              ],
            },
          ),
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
        assets: [
          // Never checked: confirmed, no evidence yet, and nobody answers
          // for it. Beside it a duty that ended a month ago.
          waterMeter('Wasserzähler Werkstatt', 'WZ-2001', 'E.01', [], {
            duties: [
              { ...yearly('Sichtprüfung der Zähleranlage'), ...ownStaff },
              {
                ...yearly('Eichung des alten Zählers', 500),
                responsible: 'preview-lindner',
                endedDaysAgo: 30,
              },
            ],
          }),
          // No package describes it yet: the general kind of its cost group,
          // which the catalogue proposes nothing for, and a duty of the
          // operator's own, which such an asset may carry from the start.
          {
            kind: 'allgemein.ventilation_and_air_conditioning',
            name: 'Lüftungsgerät Werkstatt',
            manufacturer: 'Beispiel Lufttechnik',
            yearBuilt: 2009,
            values: {},
            room: 'E.01',
            duties: [
              {
                ...yearly('Filterwechsel nach Angabe des Herstellers', 60),
                responsible: 'preview-yilmaz',
                ...ownStaff,
              },
            ],
          },
        ],
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
              {
                number: 'E.14',
                name: 'Heizraum',
                use: 'Haustechnik',
                // A duty of the room itself, due within three weeks, and
                // nobody is named for it.
                duties: [
                  {
                    label: 'Heizraum frei von Brandlasten',
                    basis: 'own_decision',
                    sourceNote: 'Brandschutzordnung Teil C',
                    intervalMonths: 3,
                    metDaysAgo: [72],
                    ...ownStaff,
                  },
                ],
              },
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
            manufacturer: 'Beispiel Aufzüge',
            model: 'BA 630',
            // The serial number the form of a new asset is tried with: the
            // same one typed there names this asset as a possible duplicate.
            serialNumber: 'BA-630-12-0193',
            mark: 'AZ-01',
            yearBuilt: 2012,
            values: { firefighters_lift: false, stops: 2 },
            duties: [
              {
                ...mainTest(100),
                responsible: 'preview-roth',
                ...contractor('Prüfdienst Beispiel GmbH'),
              },
            ],
            defect: 'Notruf im Fahrkorb ohne Verbindung',
          },
          waterMeter(
            'Hauptwasserzähler Schulhaus',
            'WZ-3001',
            'E.14',
            [
              // Rests: out of service, whatever its duty says.
              waterMeter('Unterzähler Sporthalle', 'WZ-3002', 'E.14', [], {
                lifecycle: outOfServiceThisYear,
                supplies: ['Sporthalle'],
                duties: [
                  {
                    ...yearly('Sichtprüfung der Zähleranlage', 500),
                    responsible: 'preview-roth',
                    ...ownStaff,
                  },
                ],
              }),
            ],
            { supplies: ['Schulhaus'] },
          ),
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

/** Somebody the Leitung asked to join the building services, as the route takes it. */
export const sampleInvitation = {
  name: 'Kai Neumann',
  email: 'k.neumann@beispielstadt.example',
  roles: ['technician'],
  send: 'link',
} as const

/** The area that invitation names. */
export const sampleInvitationArea: PreviewArea = 'Süd'

/** A day counted from the one the preview is started on, so that it lies ahead on every start. */
function daysAhead(days: number): string {
  const day = new Date(`${dayInGermany()}T00:00:00Z`)

  day.setUTCDate(day.getUTCDate() + days)

  return day.toISOString().slice(0, 10)
}

/**
 * Who leads the north stands in for who leads the south, from next week on
 * for twelve days: the two are colleagues of the preview
 * (`previewColleagues`), named by the id of their account.
 */
export const sampleSubstitution = {
  substitute: 'preview-lindner',
  absent: 'preview-roth',
  startsOn: daysAhead(7),
  endsOn: daysAhead(18),
} as const

/** A request of the planting, which fails with the answer of the server when it is refused. */
async function send(
  address: string,
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<{ id: string }> {
  const response = await fetch(`${address}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
  }

  return (await response.json()) as { id: string }
}

/** What an asset supplies, kept until every building of its property is there to be named. */
interface Supplying {
  readonly assetId: string
  readonly buildings: readonly string[]
}

/**
 * What no route writes yet and the preview writes behind them once the
 * planting is done (`sample-standings.ts`): the evidence of the duties, each
 * on a day, and the defects of the assets.
 */
export interface PlantedStandings {
  readonly evidence: {
    readonly dutyId: string
    readonly performedOn: string
    readonly result?: 'failed'
    readonly voidedBecause?: string
    /** The day of the evidence of the same duty this one corrects. */
    readonly corrects?: string
  }[]
  readonly defects: { readonly assetId: string; readonly description: string }[]
}

/**
 * A duty at an asset or a room, confirmed through the route as whoever keeps
 * the register would, and ended through its route where it has ended.
 */
async function plantDuty(
  address: string,
  target: { readonly assetId: string } | { readonly roomId: string },
  duty: SampleDuty,
  standings: PlantedStandings,
): Promise<void> {
  const {
    metDaysAgo = [],
    kind,
    label,
    basis = 'manufacturer',
    sourceNote = 'Betriebsanleitung des Herstellers',
    intervalMonths,
    responsible,
    performer,
    performerNote,
    endedDaysAgo,
    alsoRecorded = [],
  } = duty
  const made = await send(address, '/duties', {
    ...target,
    intervalMonths,
    ...(kind === undefined ? { label, basis, sourceNote } : { kind }),
    ...(responsible === undefined ? {} : { responsibleUserId: responsible }),
    ...(performer === undefined ? {} : { performer }),
    ...(performerNote === undefined ? {} : { performerNote }),
  })

  for (const days of metDaysAgo) {
    standings.evidence.push({ dutyId: made.id, performedOn: daysAhead(-days) })
  }

  for (const { daysAgo, result, voidedBecause, correctsDaysAgo } of alsoRecorded) {
    standings.evidence.push({
      dutyId: made.id,
      performedOn: daysAhead(-daysAgo),
      ...(result === undefined ? {} : { result }),
      ...(voidedBecause === undefined ? {} : { voidedBecause }),
      ...(correctsDaysAgo === undefined ? {} : { corrects: daysAhead(-correctsDaysAgo) }),
    })
  }

  if (endedDaysAgo !== undefined) {
    await send(address, `/duties/${made.id}/end`, {
      endsOn: daysAhead(-endedDaysAgo),
      endReason: 'Der Zähler wurde getauscht.',
    })
  }
}

async function plantAsset(
  address: string,
  path: string,
  asset: SampleAsset,
  rooms: ReadonlyMap<string, string>,
  supplying: Supplying[],
  standings: PlantedStandings,
): Promise<void> {
  const {
    components = [],
    room,
    lifecycle = [],
    supplies = [],
    duties = [],
    defect,
    ...fields
  } = asset
  const roomId = room === undefined ? undefined : rooms.get(room)
  const created = await send(address, path, {
    ...fields,
    ...(asset.meterNumber === undefined ? {} : { meterUnit: 'cubic_metres' }),
    ...(roomId === undefined ? {} : { roomId }),
  })

  for (const entry of [{ state: 'in_service', validFrom: inServiceSince }, ...lifecycle]) {
    await send(address, `/assets/${created.id}/lifecycle`, entry)
  }

  if (supplies.length > 0) {
    supplying.push({ assetId: created.id, buildings: supplies })
  }

  for (const duty of duties) {
    await plantDuty(address, { assetId: created.id }, duty, standings)
  }

  if (defect !== undefined) {
    standings.defects.push({ assetId: created.id, description: defect })
  }

  for (const component of components) {
    await plantAsset(
      address,
      `/assets/${created.id}/components`,
      component,
      rooms,
      supplying,
      standings,
    )
  }
}

/**
 * Plants the sample operator through the routes of the preview at `address`,
 * as whoever that preview answers as, which has to be somebody who sees every
 * area and keeps the places: the Leitung. Hands back what is left to write
 * behind the routes.
 */
export async function plantSampleData(
  address: string,
  areas: ReadonlyMap<PreviewArea, string>,
): Promise<PlantedStandings> {
  const standings: PlantedStandings = { evidence: [], defects: [] }

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

    const buildingIds = new Map<string, string>()
    const supplying: Supplying[] = []

    for (const building of buildings) {
      const { floors, assets, closures = [], ...buildingFields } = building
      const madeBuilding = await send(
        address,
        `/properties/${created.id}/buildings`,
        buildingFields,
      )
      const rooms = new Map<string, string>()

      buildingIds.set(building.name, madeBuilding.id)

      for (const closure of closures) {
        await send(address, `/buildings/${madeBuilding.id}/closures`, closure)
      }

      for (const floor of floors) {
        const madeFloor = await send(address, `/buildings/${madeBuilding.id}/floors`, {
          name: floor.name,
          level: floor.level,
        })

        for (const { duties = [], ...room } of floor.rooms) {
          const madeRoom = await send(address, `/floors/${madeFloor.id}/rooms`, room)
          rooms.set(room.number, madeRoom.id)

          for (const duty of duties) {
            await plantDuty(address, { roomId: madeRoom.id }, duty, standings)
          }
        }
      }

      for (const asset of assets) {
        await plantAsset(
          address,
          `/buildings/${madeBuilding.id}/assets`,
          asset,
          rooms,
          supplying,
          standings,
        )
      }
    }

    // Once every building of the property is there: an asset may supply one
    // that was made after its own.
    for (const { assetId, buildings: names } of supplying) {
      await send(
        address,
        `/assets/${assetId}/supplies`,
        { buildingIds: names.map((name) => buildingIds.get(name)) },
        'PUT',
      )
    }
  }

  // Somebody asked to join, with a role and an area, and somebody who stands
  // in for a colleague, so that "Zugänge" shows both (#84). The link of the
  // invitation is handed back once and kept nowhere: nobody takes it up.
  await send(address, '/staff', {
    ...sampleInvitation,
    additions: { all: false, areaIds: [areas.get(sampleInvitationArea)] },
  })
  await send(address, '/substitutions', sampleSubstitution)

  return standings
}
