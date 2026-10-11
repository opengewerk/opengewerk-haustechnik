import {
  type ActivityKind,
  type ActivityStatus,
  activityStatusLabel,
  assetMarkLabel,
  closeness,
  type RecordState,
  type Right,
  roomTitle,
  type SearchAnswer,
  type SearchHit as Found,
  type SearchKind,
  searchKinds,
  searchLimits,
  shownMark,
} from '@opengewerk/haustechnik-domain'
import type { SearchFound, SearchHit, SearchKind as KindWords } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import {
  maybeText,
  request,
  RequestRefused,
  type SyncClient,
  text,
} from '@opengewerk/platform-web/sync'
import { Building, Building2, Calendar, DoorOpen, FileCheck, Zap } from 'lucide-react'

/**
 * The search by name, number and mark (section 3 of the concept, #125), as
 * both entries hand it to the foundation: the kinds with their words and
 * symbols, the lines of a hit, and where it is searched. With a network the
 * server is asked, which searches in the areas of the person; without one,
 * or when the server cannot be reached, the device searches what it holds
 * the same way (decision 24 of phase 1). Where a hit opens, each entry says.
 */

/** The kinds in the order their groups stand, with the symbols of the navigation. */
export const searchKindWords: readonly KindWords[] = [
  { key: 'property', title: 'Liegenschaften', icon: Building2 },
  { key: 'building', title: 'Gebäude', icon: Building },
  { key: 'room', title: 'Räume', icon: DoorOpen },
  { key: 'asset', title: 'Anlagen', icon: Zap },
  { key: 'activity', title: 'Vorgänge', icon: Calendar },
  { key: 'evidence', title: 'Nachweise', icon: FileCheck },
] satisfies readonly (KindWords & { readonly key: SearchKind })[]

export const searchSentences = {
  about: 'Nach Name, Nummer und Kennzeichen',
  /** In the office, where the foot says what the search looks for until it says where it looked. */
  officeOnDevice: 'Ohne Netz: gesucht in dem, was dieses Gerät hält.',
  siteOnServer:
    'Gesucht auf dem Server, in Ihren Bereichen. Was dieses Gerät nicht hält, öffnet im Büro.',
  siteOnDevice: 'Ohne Netz sucht das Gerät in dem, was es hält.',
  inTheOffice: 'Öffnet im Büro',
} as const

/** The right a kind of hit asks for, as the route asks it. */
export const searchRights: Readonly<Record<SearchKind, Right>> = {
  property: 'location.read',
  building: 'location.read',
  room: 'location.read',
  asset: 'asset.read',
  activity: 'activity.read',
  evidence: 'evidence.read',
}

/** What an activity is in a hit: shorter than in a list, as the boards say it. */
const activityWord: Readonly<Record<ActivityKind, string>> = {
  round: 'Rundgang',
  inspection: 'Prüfung',
  maintenance: 'Wartung',
  work_order: 'Auftrag',
}

function joined(parts: readonly (string | null | undefined)[], between: string): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(between)
}

/** The title of a hit and the line under it, the same in both entries. */
export function hitLines(hit: Found): { readonly title: string; readonly detail: string } {
  switch (hit.kind) {
    case 'property':
      return { title: hit.name, detail: hit.address }
    case 'building':
      return {
        title: hit.name,
        detail: joined(
          [hit.shortCode === null ? null : `Kürzel ${hit.shortCode}`, hit.property],
          ' · ',
        ),
      }
    case 'room':
      return {
        title: roomTitle(hit),
        detail: joined([hit.property, hit.building, hit.floor], ', '),
      }
    case 'asset':
      return {
        title: joined([hit.number, hit.name], ' '),
        detail: joined(
          [
            hit.mark === null ? null : `${assetMarkLabel[hit.mark.field]} ${hit.mark.value}`,
            joined([hit.building, hit.room], ', '),
          ],
          ' · ',
        ),
      }
    case 'activity':
      return {
        title: joined([hit.number, hit.title], ' '),
        detail: joined(
          [
            activityWord[hit.activityKind],
            hit.place,
            activityStatusLabel[hit.status].toLocaleLowerCase('de'),
          ],
          ' · ',
        ),
      }
    case 'evidence':
      return {
        title: joined([hit.number, hit.title], ' '),
        detail: `Nachweis vom ${date(hit.performedOn)} · ${hit.place}`,
      }
  }
}

/**
 * Where the office shows a hit. Written here and not taken from the office:
 * the entry on site leads there with a plain link for what the device does
 * not hold, and loads nothing of the office for it. A test of the office
 * holds the two together.
 */
export function officeOpens(hit: Found): string {
  switch (hit.kind) {
    case 'property':
      return `/liegenschaften/${hit.id}`
    case 'building':
      return `/gebaeude/${hit.id}`
    case 'room':
      return `/raeume/${hit.id}`
    case 'asset':
      return `/anlagen/${hit.id}`
    case 'activity':
      return hit.activityKind === 'round'
        ? `/rundgaenge/${hit.id}`
        : hit.activityKind === 'work_order'
          ? `/auftraege/${hit.id}`
          : `/pruefungen/${hit.id}`
    case 'evidence':
      return `/nachweise/${hit.id}`
  }
}

/** The rows of a kind on the device that are not removed. */
function standing(client: SyncClient, entity: string): readonly RecordState[] {
  return client.list(entity).filter((record) => maybeText(record, 'deletedAt') === null)
}

function byId(records: readonly RecordState[]): ReadonlyMap<string, RecordState> {
  return new Map(records.map((record) => [String(record['id']), record]))
}

/** A number and a name as one line, as the server searches it. */
function line(number: string | null, name: string | null): string {
  return joined([number, name], ' ')
}

/** One found row, with how close it came and what orders it among the equally close. */
interface Ranked {
  readonly hit: Found
  readonly close: number
  readonly order: readonly string[]
}

function ranked(rows: readonly Ranked[]): {
  readonly hits: readonly Found[]
  readonly more: boolean
} {
  const sorted = [...rows].sort((a, b) => {
    if (a.close !== b.close) {
      return a.close - b.close
    }

    for (const [index, key] of a.order.entries()) {
      const other = b.order[index] ?? ''
      const compared = key.localeCompare(other, 'de')

      if (compared !== 0) {
        return compared
      }
    }

    return 0
  })

  return {
    hits: sorted.slice(0, searchLimits.perKind).map((row) => row.hit),
    more: sorted.length > searchLimits.perKind,
  }
}

/**
 * Searches what the device holds the way the server searches its rows: the
 * same texts, the closest first, at most five of a kind. What the device
 * holds is already what the person may see; an evidence it never holds.
 */
export function searchDevice(
  client: SyncClient,
  words: string,
  may: (kind: SearchKind) => boolean,
): SearchAnswer {
  const properties = standing(client, 'properties')
  const buildings = standing(client, 'buildings')
  const floors = standing(client, 'floors')
  const rooms = standing(client, 'rooms')
  const propertyOf = byId(properties)
  const buildingOf = byId(buildings)
  const floorOf = byId(floors)
  const roomOf = byId(rooms)
  const name = (records: ReadonlyMap<string, RecordState>, id: unknown): string => {
    const record = records.get(String(id))

    return record === undefined ? '' : text(record, 'name')
  }
  const found = (kind: SearchKind, rows: () => readonly (Ranked | null)[]) =>
    may(kind)
      ? ranked(rows().filter((row): row is Ranked => row !== null && row.close < 3))
      : { hits: [], more: false }

  const answers: Record<SearchKind, { readonly hits: readonly Found[]; readonly more: boolean }> = {
    property: found('property', () =>
      properties.map((property) => ({
        hit: {
          kind: 'property',
          id: String(property['id']),
          name: text(property, 'name'),
          address: `${text(property, 'street')}, ${text(property, 'postalCode')} ${text(property, 'city')}`,
        },
        close: closeness([text(property, 'name')], words),
        order: [text(property, 'name')],
      })),
    ),
    building: found('building', () =>
      buildings.map((building) => {
        const shortCode = maybeText(building, 'shortCode')

        return {
          hit: {
            kind: 'building',
            id: String(building['id']),
            name: text(building, 'name'),
            shortCode,
            property: name(propertyOf, building['propertyId']),
          },
          close: closeness([text(building, 'name'), shortCode], words),
          order: [text(building, 'name')],
        }
      }),
    ),
    room: found('room', () =>
      rooms.map((room) => {
        const number = maybeText(room, 'number')
        const roomName = maybeText(room, 'name')

        return {
          hit: {
            kind: 'room',
            id: String(room['id']),
            number,
            name: roomName,
            property: name(propertyOf, room['propertyId']),
            building: name(buildingOf, room['buildingId']),
            floor: name(floorOf, room['floorId']),
          },
          close: closeness([number, roomName, line(number, roomName)], words),
          order: [number ?? '', roomName ?? ''],
        }
      }),
    ),
    asset: found('asset', () =>
      standing(client, 'assets').map((asset) => {
        const number = maybeText(asset, 'number')
        const marks = {
          mark: maybeText(asset, 'mark'),
          serialNumber: maybeText(asset, 'serialNumber'),
          meterNumber: maybeText(asset, 'meterNumber'),
        }
        const room =
          maybeText(asset, 'roomId') === null ? undefined : roomOf.get(String(asset['roomId']))

        return {
          hit: {
            kind: 'asset',
            id: String(asset['id']),
            number,
            name: text(asset, 'name'),
            mark: shownMark(marks, words),
            building: name(buildingOf, asset['buildingId']),
            room:
              room === undefined
                ? null
                : line(maybeText(room, 'number'), maybeText(room, 'name')) || null,
          },
          close: closeness(
            [
              number,
              text(asset, 'name'),
              ...Object.values(marks),
              line(number, text(asset, 'name')),
            ],
            words,
          ),
          order: [number ?? '', text(asset, 'name')],
        }
      }),
    ),
    activity: found('activity', () => {
      const numbers = new Map(
        standing(client, 'work_orders').map((order) => [
          String(order['activityId']),
          maybeText(order, 'number'),
        ]),
      )

      return standing(client, 'activities').map((activity) => {
        const id = String(activity['id'])
        const number = numbers.get(id) ?? null
        const title = text(activity, 'title')
        const building = maybeText(activity, 'buildingId')

        return {
          hit: {
            kind: 'activity',
            id,
            activityKind: text(activity, 'kind') as ActivityKind,
            number,
            title,
            status: text(activity, 'status') as ActivityStatus,
            place:
              building === null
                ? name(propertyOf, activity['propertyId'])
                : name(buildingOf, building),
          },
          close: closeness([title, number, line(number, title)], words),
          order: [title],
        }
      })
    }),
    evidence: { hits: [], more: false },
  }

  return {
    hits: searchKinds.flatMap((kind) => answers[kind].hits),
    more: searchKinds.filter((kind) => answers[kind].more),
  }
}

/** Where an answer came from: the server, or the device. */
export interface Searched {
  readonly answer: SearchAnswer
  readonly onDevice: boolean
}

/**
 * Asks the server while the device has a network, and searches the device
 * without one or when the server cannot be reached. A refusal of the server
 * is passed on with its sentence: it is no missing network.
 */
export async function searchFor(
  client: SyncClient,
  words: string,
  may: (kind: SearchKind) => boolean,
  signal: AbortSignal,
): Promise<Searched> {
  if (client.status().online) {
    try {
      const answer = await request<SearchAnswer>(
        `/search?${new URLSearchParams({ q: words }).toString()}`,
        { signal },
      )

      return { answer, onDevice: false }
    } catch (error) {
      if (error instanceof RequestRefused || signal.aborted) {
        throw error
      }
    }
  }

  return { answer: searchDevice(client, words, may), onDevice: true }
}

/** What an answer becomes for the foundation, with the address each entry gives a hit. */
export function foundFor(
  searched: Searched,
  opens: (hit: Found) => { readonly to: string; readonly away?: string },
  note: string | null,
): SearchFound {
  return {
    hits: searched.answer.hits.map((hit): SearchHit => ({
      kind: hit.kind,
      id: hit.id,
      ...hitLines(hit),
      ...opens(hit),
    })),
    more: searched.answer.more,
    note,
  }
}
