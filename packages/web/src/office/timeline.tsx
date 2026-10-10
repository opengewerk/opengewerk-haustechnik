import {
  type ActivityKind,
  activityOutcomeLabel,
  defectStatusLabel,
  evidenceResultLabel,
  type Timeline,
  type TimelineCategory,
  timelineCategories,
  timelineCategoryLabel,
  timelineCategoryOf,
  type TimelineEvent,
  timelineEventWords,
  timelinePage,
  type TimelinePlace,
} from '@opengewerk/haustechnik-domain'
import { Button, Panel, Status, type StatusTone } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { Chip, Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { maybeText, request, RequestRefused, text, useRecord } from '@opengewerk/platform-web/sync'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  Ban,
  Calendar,
  Check,
  CircleX,
  ClipboardList,
  FileCheck,
  GitCommitVertical,
  type LucideIcon,
  Play,
  Route,
  SearchCheck,
  ShieldCheck,
  Signature,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { placePath } from '../app/place-path.js'
import { placeAbove, titleOfRoom } from '../app/place-records.js'
import { activityPlaces } from './activity-addresses.js'
import { defectPlaces } from './defect-addresses.js'
import { evidencePlaces } from './duty-addresses.js'
import { officePlaces } from './place-addresses.js'
import { roundPlaces } from './round-template-addresses.js'
import { workOrderPlaces } from './work-order-addresses.js'

/**
 * The timeline of a place in the office (4.1 of the concept, #123): what
 * happened at a property, a building, a room or an asset and below it, the
 * newest first, grouped by month, narrowed to a category, a page at a time;
 * and its newest entries in a card on the page of a property. Every entry
 * leads to the page of what it is about. No person is named (decision 42 of
 * phase 1). The entries come from the server, with a connection.
 */

export const timelineWords = {
  title: 'Zeitachse',
  sub: 'alle Vorgänge über die Zeit',
  noConnection: 'Die Zeitachse kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Zeitachse wird geladen.',
  failed: 'Die Zeitachse ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  none: 'Hier ist noch nichts geschehen, was die Zeitachse nennt.',
  nothingPasses: 'Nichts von dieser Art ist hier geschehen.',
  older: 'Ältere laden',
  whole: 'Ganze Zeitachse',
  note: 'Dieselbe Zeitachse gibt es an jeder Liegenschaft, jedem Gebäude, jedem Raum und jeder Anlage. Sie nennt keine Person; wer etwas getan hat, steht auf der Seite des Vorgangs.',
} as const

/** The address of the timeline of a place. */
export function timelinePathOf(place: TimelinePlace): string {
  if ('propertyId' in place) {
    return `${officePlaces.property(place.propertyId)}/zeitachse`
  }

  if ('buildingId' in place) {
    return `${officePlaces.building(place.buildingId)}/zeitachse`
  }

  if ('roomId' in place) {
    return `${officePlaces.room(place.roomId)}/zeitachse`
  }

  return `${officePlaces.asset(place.assetId)}/zeitachse`
}

/** The word of the address for the category the timeline is narrowed to. */
const categoryWord = 'art'

/** What a page of a timeline is asked of the server with. */
export function timelineRequest(
  place: TimelinePlace,
  category: TimelineCategory | null,
  offset: number,
  limit: number = timelinePage.size,
): string {
  const query = new URLSearchParams()
  const [[key, id] = ['propertyId', '']] = Object.entries(place) as [string, string][]

  query.set(
    { propertyId: 'property', buildingId: 'building', roomId: 'room', assetId: 'asset' }[
      key as 'propertyId'
    ],
    id,
  )

  if (category !== null) {
    query.set('category', category)
  }

  query.set('offset', String(offset))
  query.set('limit', String(limit))

  return `/overview/timeline?${query.toString()}`
}

const retry = (count: number, error: unknown) => !(error instanceof RequestRefused) && count < 2

/** The symbol of an entry, as the navigation has it for what it belongs to. */
const categoryIcons: Readonly<Record<TimelineCategory, LucideIcon>> = {
  rounds: Route,
  inspections: SearchCheck,
  defects: TriangleAlert,
  work_orders: Calendar,
  evidence: FileCheck,
}

/** How what an entry is about stands now, in words, a tone and a symbol. */
function markOf(event: TimelineEvent): { label: string; tone: StatusTone; icon: LucideIcon } {
  const { mark } = event

  if (mark.kind === 'activity') {
    switch (mark.outcome) {
      case 'open':
        return { label: 'Offen', tone: 'neutral', icon: ClipboardList }
      case 'started':
        return { label: activityOutcomeLabel.started, tone: 'waiting', icon: Play }
      case 'signed':
        return { label: activityOutcomeLabel.signed, tone: 'waiting', icon: Signature }
      case 'not_performed':
        return { label: activityOutcomeLabel.not_performed, tone: 'neutral', icon: Ban }
      case 'with_defects':
        return { label: activityOutcomeLabel.with_defects, tone: 'conflict', icon: TriangleAlert }
      case 'failed':
        return { label: activityOutcomeLabel.failed, tone: 'conflict', icon: CircleX }
      default:
        return { label: activityOutcomeLabel[mark.outcome], tone: 'done', icon: Check }
    }
  }

  if (mark.kind === 'defect') {
    return {
      label: defectStatusLabel[mark.status],
      tone: mark.status === 'found' ? 'conflict' : mark.status === 'ordered' ? 'waiting' : 'done',
      icon:
        mark.status === 'found'
          ? TriangleAlert
          : mark.status === 'ordered'
            ? ClipboardList
            : mark.status === 'verified'
              ? ShieldCheck
              : Check,
    }
  }

  if (mark.voided) {
    return { label: 'Für ungültig erklärt', tone: 'conflict', icon: Ban }
  }

  return {
    label: evidenceResultLabel[mark.result],
    tone: mark.result === 'without_defects' ? 'done' : 'conflict',
    icon: mark.result === 'without_defects' ? Check : TriangleAlert,
  }
}

/** The page of what an entry is about. */
function pageOf(event: TimelineEvent): string {
  const { subject } = event

  switch (subject.type) {
    case 'defect':
      return defectPlaces.defect(subject.id)
    case 'evidence':
      return evidencePlaces.evidence(subject.id)
    default:
      return subject.activityKind === 'round'
        ? roundPlaces.round(subject.id)
        : subject.activityKind === 'work_order'
          ? workOrderPlaces.order(subject.id)
          : activityPlaces.activity(subject.id)
  }
}

/** What an entry is about, a number first where it has one. */
function whatOf(event: TimelineEvent): string {
  return event.number === null || event.subject.type === 'defect'
    ? event.title
    : `${event.number} ${event.title}`
}

function activityOf(event: TimelineEvent): ActivityKind | null {
  return event.subject.type === 'activity' ? event.subject.activityKind : null
}

/**
 * One entry: the day, a symbol, what happened and what about, and how that
 * stands now. In the card of a property the day is whole and there is no
 * symbol, as the board of the property draws it.
 */
function EventRow({
  event,
  day,
  inCard = false,
}: {
  readonly event: TimelineEvent
  readonly day: string
  readonly inCard?: boolean
}) {
  const Icon = categoryIcons[timelineCategoryOf(event.kind, activityOf(event))]
  const mark = markOf(event)

  return (
    <li className="border-b border-row last:border-b-0">
      <Link
        to={pageOf(event)}
        className={`grid items-center gap-2.5 px-3.5 py-2 text-ink no-underline ${
          inCard
            ? 'grid-cols-[86px_minmax(0,1fr)] sm:grid-cols-[86px_minmax(0,1fr)_auto]'
            : 'grid-cols-[56px_28px_minmax(0,1fr)] sm:grid-cols-[56px_28px_minmax(0,1fr)_auto]'
        }`}
      >
        <span className="numeric text-[13px] text-ink-faint">{day}</span>
        {inCard ? null : (
          <span
            aria-hidden="true"
            className="flex size-[26px] items-center justify-center rounded-full bg-surface-sunken text-ink-muted"
          >
            <Icon size={14} strokeWidth={2} />
          </span>
        )}
        <span className="min-w-0 leading-[1.35]">
          <span className="block text-[13px] font-semibold">
            {timelineEventWords(event.kind, activityOf(event))}
          </span>
          <span className="block text-[12px] text-ink-faint [overflow-wrap:anywhere]">
            {whatOf(event)}
          </span>
        </span>
        <span
          className={inCard ? 'col-start-2 sm:col-start-auto' : 'col-start-3 sm:col-start-auto'}
        >
          <Status tone={mark.tone} icon={mark.icon}>
            {mark.label}
          </Status>
        </span>
      </Link>
    </li>
  )
}

/** "Oktober 2026": the month an entry stands under. */
const monthWords = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function monthOf(day: string): string {
  return monthWords.format(new Date(`${day.slice(0, 7)}-01T00:00:00Z`))
}

/**
 * "Zeitachse", the page of the timeline of a place, the board "Zeitachse
 * eines Gebäudes": the entries by month, the categories as chips in the
 * address, and the way to older entries.
 */
export function TimelineScreen() {
  const params = useParams({ strict: false }) as Readonly<Record<string, string | undefined>>
  const search = useSearch({ strict: false }) as Readonly<Record<string, unknown>>
  const navigate = useNavigate()
  const place: TimelinePlace | null =
    params['propertyId'] !== undefined
      ? { propertyId: params['propertyId'] }
      : params['buildingId'] !== undefined
        ? { buildingId: params['buildingId'] }
        : params['roomId'] !== undefined
          ? { roomId: params['roomId'] }
          : params['assetId'] !== undefined
            ? { assetId: params['assetId'] }
            : null
  const asked = search[categoryWord]
  const category = (timelineCategories as readonly unknown[]).includes(asked)
    ? (asked as TimelineCategory)
    : null
  const where = usePlaceWords(place)
  const pages = useInfiniteQuery({
    queryKey: ['overview', 'timeline', place, category],
    queryFn: ({ pageParam }) =>
      request<Timeline>(timelineRequest(place as TimelinePlace, category, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.more ? all.reduce((sum, page) => sum + page.events.length, 0) : undefined,
    enabled: place !== null,
    retry,
  })
  const events = pages.data?.pages.flatMap((page) => page.events) ?? []
  const choose = (next: TimelineCategory | null) => {
    void navigate({
      to: place === null ? '/' : timelinePathOf(place),
      search: next === null ? {} : { [categoryWord]: next },
      replace: true,
    })
  }
  const months = events.reduce<{ month: string; events: TimelineEvent[] }[]>((groups, event) => {
    const month = monthOf(event.day)
    const last = groups[groups.length - 1]

    if (last?.month === month) {
      last.events.push(event)
    } else {
      groups.push({ month, events: [event] })
    }

    return groups
  }, [])

  return (
    <Screen>
      <PageHead
        title={timelineWords.title}
        sub={where === null ? timelineWords.sub : `${where.name}, ${timelineWords.sub}`}
        {...(where === null ? {} : { crumbs: where.crumbs, phoneBack: where.back })}
      />
      <div role="group" aria-label="Art" className="flex flex-wrap gap-1.5">
        <Chip
          pressed={category === null}
          onPress={() => {
            choose(null)
          }}
        >
          Alle
        </Chip>
        {timelineCategories.map((each) => (
          <Chip
            key={each}
            pressed={category === each}
            onPress={() => {
              choose(each)
            }}
          >
            {timelineCategoryLabel[each]}
          </Chip>
        ))}
      </div>
      {pages.data === undefined ? (
        <Panel>
          <Empty>
            {pages.isError
              ? timelineWords.failed
              : pages.fetchStatus === 'paused'
                ? timelineWords.noConnection
                : timelineWords.loading}
          </Empty>
        </Panel>
      ) : events.length === 0 ? (
        <Panel>
          <Empty>{category === null ? timelineWords.none : timelineWords.nothingPasses}</Empty>
        </Panel>
      ) : (
        <section
          aria-label="Einträge der Zeitachse"
          className="overflow-clip rounded-[5px] border border-line bg-surface"
        >
          {months.map((group) => (
            <div key={group.month}>
              <h2 className="border-b border-line bg-ground px-3.5 py-[9px] font-condensed text-[12px] font-semibold uppercase tracking-[1.1px] text-ink-faint">
                {group.month}
              </h2>
              <ul>
                {group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    day={`${event.day.slice(8, 10)}.${event.day.slice(5, 7)}.`}
                  />
                ))}
              </ul>
            </div>
          ))}
          {pages.hasNextPage ? (
            <div className="px-3.5 py-[9px]">
              <button
                type="button"
                disabled={pages.isFetchingNextPage}
                onClick={() => {
                  void pages.fetchNextPage()
                }}
                className="cursor-pointer text-[13px] text-copper-text underline underline-offset-2"
              >
                {timelineWords.older}
              </button>
            </div>
          ) : null}
        </section>
      )}
      <p className="text-[13px] text-ink-muted">{timelineWords.note}</p>
    </Screen>
  )
}

/**
 * The newest entries of the timeline of a place in a card, `card('Zeitachse')`
 * on the page of a property, with the way to the whole of it. Nothing while
 * there is none, and nothing where it cannot be read.
 */
export function TimelineCard({ place }: { readonly place: TimelinePlace }) {
  const newest = useQuery({
    queryKey: ['overview', 'timeline', place, null, 'newest'],
    queryFn: () => request<Timeline>(timelineRequest(place, null, 0, 4)),
    retry,
  })
  const events = newest.data?.events ?? []

  return (
    <Panel title={timelineWords.title}>
      {newest.data === undefined ? (
        <p className="text-[13px] text-ink-muted">
          {newest.isError
            ? timelineWords.failed
            : newest.fetchStatus === 'paused'
              ? timelineWords.noConnection
              : timelineWords.loading}
        </p>
      ) : events.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{timelineWords.none}</p>
      ) : (
        <ul className="-mx-3.5">
          {events.map((event) => (
            <EventRow key={event.id} event={event} day={date(event.day)} inCard />
          ))}
        </ul>
      )}
      <div className="pt-2">
        <Link
          to={timelinePathOf(place)}
          className="text-[13px] text-copper-text underline underline-offset-2"
        >
          {timelineWords.whole}
        </Link>
      </div>
    </Panel>
  )
}

/** "Zeitachse" in the head of the page of a room or an asset, as their boards draw it. */
export function TimelineButton({ place }: { readonly place: TimelinePlace }) {
  const navigate = useNavigate()

  return (
    <Button
      icon={GitCommitVertical}
      onClick={() => {
        void navigate({ to: timelinePathOf(place) })
      }}
    >
      {timelineWords.title}
    </Button>
  )
}

/** The link to the timeline of a place, as the head of a card or a page offers it. */
export function TimelineLink({ place }: { readonly place: TimelinePlace }): ReactNode {
  return (
    <Link
      to={timelinePathOf(place)}
      className="text-[13px] text-copper-text underline underline-offset-2"
    >
      {timelineWords.title}
    </Link>
  )
}

/** What the page names the place by, the path above it and the way back on a phone. */
function usePlaceWords(place: TimelinePlace | null) {
  const asset = useRecord(
    'assets',
    place !== null && 'assetId' in place ? place.assetId : undefined,
  )
  const room = useRecord(
    'rooms',
    place !== null && 'roomId' in place
      ? place.roomId
      : asset
        ? (maybeText(asset, 'roomId') ?? undefined)
        : undefined,
  )
  const floor = useRecord('floors', room ? String(room['floorId']) : undefined)
  const building = useRecord(
    'buildings',
    place !== null && 'buildingId' in place
      ? place.buildingId
      : room
        ? String(room['buildingId'])
        : asset
          ? (maybeText(asset, 'buildingId') ?? undefined)
          : undefined,
  )
  const property = useRecord(
    'properties',
    place !== null && 'propertyId' in place
      ? place.propertyId
      : building
        ? String(building['propertyId'])
        : asset
          ? String(asset['propertyId'])
          : undefined,
  )

  if (place === null || !property) {
    return null
  }

  const crumbs = placePath(
    placeAbove({
      property,
      building: building ?? null,
      floor: 'assetId' in place ? null : (floor ?? null),
      room: room ?? null,
      asset: asset ?? null,
    }),
    officePlaces,
  )
  const name = asset
    ? text(asset, 'name')
    : room
      ? titleOfRoom(room)
      : building
        ? text(building, 'name')
        : text(property, 'name')
  const back = crumbs[crumbs.length - 1] ?? officePlaces.list

  return { name, crumbs, back }
}
