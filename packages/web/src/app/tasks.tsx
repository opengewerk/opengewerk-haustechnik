import {
  activityKindLabel,
  type ActivityKind,
  mayChangeTask,
  type RecordState,
  type TaskCandidates,
  type TaskPerson,
  taskWords,
} from '@opengewerk/haustechnik-domain'
import { accountQuery, useRight } from '@opengewerk/platform-web/session'
import { maybeText, request, text, useRecords } from '@opengewerk/platform-web/sync'
import { TaskTarget } from '@opengewerk/platform-web/tasks'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { titleOfRoom } from './place-records.js'

/**
 * The tasks of an operator in both entries (#124): who is looking, the people
 * a task may name, what may be done to one, and the record it hangs on as a
 * link. The row, the list and the form are the foundation's
 * (`@opengewerk/platform-web/tasks`); the tasks themselves are read from the
 * device and written through its outbox, in the office as on site.
 */

export { taskWords }

/** Who a task may go to, for whoever hands tasks out: asked of the server with a connection. */
export const taskCandidatesQuery = {
  queryKey: ['tasks', 'candidates'],
  queryFn: () => request<TaskCandidates>('/tasks/candidates'),
  staleTime: 5 * 60_000,
  retry: false,
} as const

/** Who is looking, and the people a task may name. */
export interface TaskPeople {
  /** Who is looking, until the session is read null. */
  readonly me: string | null
  readonly myName: string | null
  /** Everybody a name is known for: the person looking and the candidates of their areas. */
  readonly people: readonly TaskPerson[]
  /** Whoever a task in an area may go to besides the person looking; none without the right or a connection. */
  readonly othersIn: (areaId: string | null) => readonly TaskPerson[]
  /** May write tasks for themselves and do their own. */
  readonly records: boolean
  /** May hand tasks to others and change theirs. */
  readonly assigns: boolean
  /** Whether the person looking may mark this task done or open it again (`mayChangeTask`). */
  readonly mayChange: (task: RecordState) => boolean
}

export function useTaskPeople(): TaskPeople {
  const records = useRight('task.record')
  const assigns = useRight('task.assign')
  const account = useQuery(accountQuery)
  const candidates = useQuery({ ...taskCandidatesQuery, enabled: assigns })
  const me = account.data?.userId ?? null
  const myName = account.data?.name ?? null
  // An answer this screen does not understand is no list of people either.
  const areas = Array.isArray(candidates.data?.areas) ? candidates.data.areas : []
  const people = new Map<string, TaskPerson>()

  for (const area of areas) {
    for (const person of area.people) {
      people.set(person.userId, person)
    }
  }

  if (me !== null && myName !== null) {
    people.set(me, { userId: me, name: myName })
  }

  return {
    me,
    myName,
    people: [...people.values()],
    othersIn: (areaId) =>
      areaId === null ? [] : (areas.find((area) => area.areaId === areaId)?.people ?? []),
    records,
    assigns,
    mayChange: (task) =>
      records &&
      me !== null &&
      mayChangeTask(me, { assigneeUserId: text(task, 'assigneeUserId') }, assigns),
  }
}

/** Where the pages of the records a task hangs on are, in one entry. */
export interface TaskAddresses {
  readonly property: (id: string) => string
  readonly building: (id: string) => string
  readonly room: (id: string) => string
  readonly asset: (id: string) => string
  /** The page of an activity, which depends on its kind; null where the entry has none. */
  readonly activity: (id: string, kind: string) => string | null
}

/** The records a task hangs on, as the device holds them, by id. */
function byId(records: readonly RecordState[]): ReadonlyMap<string, RecordState> {
  return new Map(records.map((record) => [String(record['id']), record]))
}

/** The words for the record a task hangs on: what the link under a task says, and what kind it is. */
export interface TaskHome {
  readonly to: string
  readonly label: string
  readonly kind: 'property' | 'building' | 'room' | 'asset' | 'activity'
}

/**
 * The record each task hangs on, as a link to its page, read from what the
 * device holds: the most particular one it names, the property where it names
 * nothing else. A record the device does not hold is not linked.
 */
export function useTaskHomes(
  addresses: TaskAddresses,
  entry: 'office' | 'site' = 'office',
): (task: RecordState) => TaskHome | null {
  const properties = byId(useRecords('properties'))
  const buildings = byId(useRecords('buildings'))
  const rooms = byId(useRecords('rooms'))
  const assets = byId(useRecords('assets'))
  const activities = byId(useRecords('activities'))
  const orderNumbers = new Map(
    useRecords('work_orders').map((order) => [
      text(order, 'activityId'),
      maybeText(order, 'number'),
    ]),
  )
  const name = (record: RecordState | undefined) => maybeText(record ?? null, 'name') ?? ''

  return (task) => {
    const id = (field: string) => maybeText(task, field)
    const assetId = id('assetId')
    const roomId = id('roomId')
    const buildingId = id('buildingId')
    const activityId = id('activityId')
    const propertyId = id('propertyId')

    if (assetId !== null) {
      const asset = assets.get(assetId)

      return asset
        ? {
            to: addresses.asset(assetId),
            label: [maybeText(asset, 'number'), name(asset)].filter(Boolean).join(' '),
            kind: 'asset',
          }
        : null
    }

    if (roomId !== null) {
      const room = rooms.get(roomId)

      return room
        ? {
            to: addresses.room(roomId),
            label: [`Raum ${titleOfRoom(room)}`, name(buildings.get(text(room, 'buildingId')))]
              .filter(Boolean)
              .join(', '),
            kind: 'room',
          }
        : null
    }

    if (buildingId !== null) {
      const building = buildings.get(buildingId)

      return building
        ? {
            to: addresses.building(buildingId),
            label: [`Gebäude ${name(building)}`, name(properties.get(text(building, 'propertyId')))]
              .filter(Boolean)
              .join(', '),
            kind: 'building',
          }
        : null
    }

    if (activityId !== null) {
      const activity = activities.get(activityId)
      const kind = maybeText(activity ?? null, 'kind')
      const to = activity && kind ? addresses.activity(activityId, kind) : null

      const number = orderNumbers.get(activityId) ?? null
      // An order by its number where it has one: "Auftrag AU-2026-0032" in
      // the office, "AU-2026-0032 Notleuchte tauschen" on site, as the boards
      // name it; anything else by its kind and title.
      const label =
        number === null
          ? `${activityKindLabel[kind as ActivityKind]} ${text(activity ?? null, 'title')}`
          : entry === 'site'
            ? `${number} ${text(activity ?? null, 'title')}`
            : `${activityKindLabel[kind as ActivityKind]} ${number}`

      return activity && kind && to ? { to, label, kind: 'activity' } : null
    }

    const property = propertyId === null ? undefined : properties.get(propertyId)

    return propertyId !== null && property
      ? {
          to: addresses.property(propertyId),
          label: `Liegenschaft ${name(property)}`,
          kind: 'property',
        }
      : null
  }
}

/** The link under a task to the record it hangs on, or nothing. */
export function taskTargetOf(
  homeOf: (task: RecordState) => TaskHome | null,
): (task: RecordState) => ReactNode {
  return (task) => {
    const home = homeOf(task)

    return home ? <TaskTarget to={home.to}>{home.label}</TaskTarget> : null
  }
}
