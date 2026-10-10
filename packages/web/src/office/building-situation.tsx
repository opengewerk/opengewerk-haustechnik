import {
  type ActivityKind,
  type ActivityOutcome,
  activityOutcomeLabel,
  type BuildingSituation,
  type LastActivity,
  type PlaceToDo,
} from '@opengewerk/haustechnik-domain'
import {
  cardLink,
  Cell,
  Column,
  Panel,
  PanelLabel,
  Status,
  type StatusTone,
  TablePanel,
} from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { Empty } from '@opengewerk/platform-web/office'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { Ban, Check, CircleX, type LucideIcon, Play, Signature, TriangleAlert } from 'lucide-react'

import { activityPlaces } from './activity-addresses.js'
import { CountTiles, type Tile } from './count-tiles.js'
import { defectListPlace, defectSearch } from './defect-addresses.js'
import { dutyRegisterPlace, dutySearch } from './duty-addresses.js'
import { meterListPlace, meterListWords } from './meter-addresses.js'
import { roundPlaces } from './round-template-addresses.js'
import { workOrderPlaces } from './work-order-addresses.js'

export const situationWords = {
  toDo: 'Zu tun',
  noConnection: 'Was zu tun ist, kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Was zu tun ist, wird geladen.',
  failed: 'Was zu tun ist, ließ sich nicht laden. Es kommt vom Server, mit Verbindung.',
  last: 'Letzte Vorgänge',
  noneLast: 'An diesem Gebäude ist noch kein Vorgang begonnen oder erledigt.',
} as const

/** The Lagebild of a building, as the server answers it (#121). */
export function buildingSituationQuery(buildingId: string) {
  return {
    queryKey: ['overview', 'building', buildingId],
    queryFn: () => request<BuildingSituation>(`/overview/buildings/${buildingId}`),
    // A refusal is an answer: asking again brings the same one.
    retry: (count: number, error: unknown) => !(error instanceof RequestRefused) && count < 2,
  } as const
}

/** "01.10.": the key date as a tile names it. */
function dayAndMonth(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.`
}

/** What is to do at a place, by the name the numbers have. */
export type ToDoKey = keyof PlaceToDo

/** A building or a property, as an address narrows a list to it. */
export type ToDoPlace = { readonly buildingId: string } | { readonly propertyId: string }

/**
 * The list a number of what is to do at a place leads to, narrowed the way
 * it counts (#121): the register of duties by state, the defects under
 * "Offen", the meters under "fehlt".
 */
export function toDoTarget(
  key: ToDoKey,
  place: ToDoPlace,
): { readonly to: string; readonly search: Record<string, string> } {
  switch (key) {
    case 'overdue':
      return { to: dutyRegisterPlace.to, search: dutySearch({ ...place, state: 'overdue' }) }
    case 'due':
      return { to: dutyRegisterPlace.to, search: dutySearch({ ...place, state: 'due' }) }
    case 'neverRecorded':
      return { to: dutyRegisterPlace.to, search: dutySearch({ ...place, state: 'never_recorded' }) }
    case 'openDefects':
      return { to: defectListPlace.to, search: defectSearch(place) }
    case 'missingReadings':
      return {
        to: meterListPlace.to,
        search: {
          ...('buildingId' in place
            ? { [meterListWords.building]: place.buildingId }
            : { [meterListWords.property]: place.propertyId }),
          [meterListWords.state]: 'missing',
        },
      }
  }
}

/** What each number is called and in which tone it stands where it is not zero. */
export const toDoColumns: readonly {
  readonly key: ToDoKey
  readonly label: string
  readonly tone: Tile['tone']
}[] = [
  { key: 'overdue', label: 'Überfällig', tone: 'conflict' },
  { key: 'due', label: 'Fällig', tone: 'waiting' },
  { key: 'neverRecorded', label: 'Nie erfasst', tone: 'neutral' },
  { key: 'openDefects', label: 'Offene Mängel', tone: 'conflict' },
  { key: 'missingReadings', label: 'Zählerstände fehlen', tone: 'waiting' },
]

/**
 * The numbers of what is to do at a place, `count_tile()` of the boards, each
 * a link to its list (`toDoTarget`). A number that is zero is drawn quiet. A
 * list the person may not read has no number.
 */
export function toDoTiles(numbers: PlaceToDo, place: ToDoPlace, keyDate: string | null): Tile[] {
  return toDoColumns.flatMap(({ key, label, tone }) => {
    const value = numbers[key]

    return value === null
      ? []
      : [
          {
            value,
            label,
            tone: value === 0 ? 'neutral' : tone,
            ...(key === 'missingReadings' && keyDate !== null
              ? { sub: `Stichtag ${dayAndMonth(keyDate)}` }
              : {}),
            ...toDoTarget(key, place),
          },
        ]
  })
}

/**
 * "Zu tun" on the page of a building, the top of `lagebild()` of the boards
 * (4.1 of the concept): what is overdue, due and never recorded there, the
 * open defects and the readings missing for the key date. The numbers come
 * from the server, and the place says so without a connection; the rest of
 * the page stands on what the device holds.
 */
export function BuildingToDo({ buildingId }: { readonly buildingId: string }) {
  const situation = useQuery(buildingSituationQuery(buildingId))
  const read = situation.data
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <PanelLabel id={headingId}>{situationWords.toDo}</PanelLabel>
      {read === undefined ? (
        <Panel>
          <Empty>
            {situation.isError
              ? situationWords.failed
              : situation.fetchStatus === 'paused'
                ? situationWords.noConnection
                : situationWords.loading}
          </Empty>
        </Panel>
      ) : (
        <CountTiles
          label="Was an diesem Gebäude zu tun ist"
          className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          tiles={toDoTiles(read, { buildingId }, read.keyDate)}
        />
      )}
    </section>
  )
}

/** What a row calls the kind of an activity, as short as the board has it. */
const kindWords: Readonly<Record<ActivityKind, string>> = {
  round: 'Rundgang',
  inspection: 'Prüfung',
  maintenance: 'Wartung',
  work_order: 'Auftrag',
}

/** The way an outcome is drawn: in words, in a tone and with a symbol of its own. */
const outcomeLooks: Readonly<Record<ActivityOutcome, { tone: StatusTone; icon: LucideIcon }>> = {
  started: { tone: 'waiting', icon: Play },
  signed: { tone: 'waiting', icon: Signature },
  not_performed: { tone: 'neutral', icon: Ban },
  without_defects: { tone: 'done', icon: Check },
  with_defects: { tone: 'conflict', icon: TriangleAlert },
  failed: { tone: 'conflict', icon: CircleX },
  done: { tone: 'done', icon: Check },
}

function OutcomeMark({ outcome }: { readonly outcome: ActivityOutcome }) {
  const look = outcomeLooks[outcome]

  return (
    <Status tone={look.tone} icon={look.icon}>
      {activityOutcomeLabel[outcome]}
    </Status>
  )
}

/** The page of an activity of any kind: a round and a work order have a page of their own. */
function pageOf(activity: LastActivity): string {
  switch (activity.kind) {
    case 'round':
      return roundPlaces.round(activity.id)
    case 'work_order':
      return workOrderPlaces.order(activity.id)
    default:
      return activityPlaces.activity(activity.id)
  }
}

/** What an activity is, a work order with its number first. */
function whatOf(activity: LastActivity): string {
  return activity.number === null ? activity.title : `${activity.number} ${activity.title}`
}

/**
 * "Letzte Vorgänge" on the page of a building, the foot of `lagebild()` of
 * the boards: the activities begun, signed, done or not performed there, at
 * its rooms and at the assets in it, the newest first, each with what came
 * of it. No person (decision 42 of phase 1): who did it stands on the page of
 * the activity. Shown only to whoever may read activities.
 */
export function LastActivities({ buildingId }: { readonly buildingId: string }) {
  const situation = useQuery(buildingSituationQuery(buildingId))
  const last = situation.data?.lastActivities

  if (last === undefined || last === null) {
    return null
  }

  return (
    <TablePanel
      title={situationWords.last}
      caption="Letzte Vorgänge an diesem Gebäude mit Tag, Art, Gegenstand und Ergebnis"
      cards={last.map((activity) => ({
        key: activity.id,
        title: (
          <Link to={pageOf(activity)} className={cardLink}>
            {whatOf(activity)}
          </Link>
        ),
        sub: `${date(activity.day)} · ${kindWords[activity.kind]}`,
        right: <OutcomeMark outcome={activity.outcome} />,
      }))}
      cardsEmpty={situationWords.noneLast}
    >
      <thead>
        <tr>
          <Column className="w-[92px]">Tag</Column>
          <Column className="w-[86px]">Vorgang</Column>
          <Column>Was</Column>
          <Column className="w-[150px]">Ergebnis</Column>
        </tr>
      </thead>
      <tbody>
        {last.length === 0 ? (
          <tr>
            <Cell colSpan={4} className="text-ink-muted">
              {situationWords.noneLast}
            </Cell>
          </tr>
        ) : (
          last.map((activity) => (
            <tr key={activity.id}>
              <Cell className="numeric">{date(activity.day)}</Cell>
              <Cell>{kindWords[activity.kind]}</Cell>
              <Cell>
                <Link to={pageOf(activity)}>{whatOf(activity)}</Link>
              </Cell>
              <Cell>
                <OutcomeMark outcome={activity.outcome} />
              </Cell>
            </tr>
          ))
        )}
      </tbody>
    </TablePanel>
  )
}
