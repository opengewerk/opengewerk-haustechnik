import type {
  DefectEntry,
  IsoDate,
  Overview,
  OverviewDuty,
  RecordState,
} from '@opengewerk/haustechnik-domain'
import { cardLink, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { Chip, Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { maybeText, request, RequestRefused, useRecords } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { DutyStateMark } from '../../app/asset-marks.js'
import { titleOfRoom } from '../../app/place-records.js'
import { useAreasQuery } from '../../session/areas.js'
import { activityListPlace, activitySearch } from '../activity-addresses.js'
import { CountTiles, type Tile } from '../count-tiles.js'
import { defectListPlace, defectPlaces, defectSearch } from '../defect-addresses.js'
import { dutyPlaces, dutyRegisterPlace, dutySearch } from '../duty-addresses.js'
import { officePlaces } from '../place-addresses.js'
import { DefectStatusMark } from './defects.js'

export const overviewWords = {
  noConnection: 'Die Übersicht kommt vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Übersicht wird geladen.',
  failed: 'Die Übersicht ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  refused: 'Die Übersicht zählt Pflichten, und dieser Zugang sieht keine.',
  soon: 'Überfällig und in 30 Tagen fällig',
  noneSoon: 'Nichts ist überfällig, und in den nächsten 30 Tagen wird nichts fällig.',
  neverRecorded: 'Nie erfasst',
  noneNever: 'Jede Pflicht ist erfasst.',
  defects: 'Mängel über ihrer Frist',
  noneDefects: 'Kein Mangel ist über seiner Frist.',
} as const

/** The word of the address for the area the overview is narrowed to, as the lists it leads to have it. */
const areaWord = 'bereich'

/** "Samstag, 10. Oktober 2026": the day the numbers are counted on. */
const longDay = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function dayWords(day: IsoDate): string {
  return longDay.format(new Date(`${day}T00:00:00Z`))
}

/**
 * "Übersicht", the start page of the office and its board "Übersicht:
 * Betreiberverantwortung" (4.3 of the concept, scenario 1, #122): over every
 * property the person sees, or over one of their areas, what is overdue,
 * what falls due in the next 30 and 90 days, where a duty was never recorded,
 * where the report of a contractor is missing and which defects are past
 * their deadline.
 *
 * Every number is a link to the list it counts, narrowed the same way and to
 * the same area: the register of duties, "Prüfungen" and the defects. The
 * server counts each with the filter of that list, so the two agree. The
 * numbers come from the server and need a connection, and the page says so
 * without one.
 *
 * It names nobody (4.16 of the concept): no person answers for anything
 * here, and nothing is counted by person. The area is part of the address,
 * so that the way back from a list leads to the overview as it was.
 */
export function OverviewScreen() {
  const search = useSearch({ strict: false }) as Readonly<Record<string, unknown>>
  const navigate = useNavigate()
  const areas = useAreasQuery()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  const known = areas.data ?? []
  const asked = typeof search[areaWord] === 'string' ? search[areaWord] : null
  // An area that is gone, or one the person no longer holds in, narrows nothing.
  const area = known.find((each) => each.id === asked) ?? null
  // Somebody who sees one area is told nothing by its name.
  const showsAreas = known.length > 1

  const overview = useQuery({
    queryKey: ['overview', area?.id ?? null],
    queryFn: () => request<Overview>(area === null ? '/overview' : `/overview?area=${area.id}`),
    // Which area the address names is known once the areas are; without a
    // connection neither comes, and the overview says so.
    enabled: !areas.isPending || areas.fetchStatus === 'paused',
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const read = overview.data
  const inArea = area === null ? {} : { areaId: area.id }

  const choose = (id: string | null) => {
    void navigate({ to: '/', search: id === null ? {} : { [areaWord]: id }, replace: true })
  }

  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const propertyOf = (propertyId: string) =>
    maybeText(byId(properties, propertyId), 'name') ?? 'Liegenschaft'
  /** What a duty hangs on: the asset by number and name, or the room, the building or the property. */
  const whereOf = (duty: OverviewDuty): { name: string; to: string; sub: string } => {
    const property = propertyOf(duty.propertyId)

    if (duty.asset !== null) {
      return {
        name: [duty.asset.number, duty.asset.name].filter(Boolean).join(' '),
        to: officePlaces.asset(duty.asset.id),
        sub: property,
      }
    }

    if (duty.roomId !== null) {
      const room = byId(rooms, duty.roomId)

      return {
        name: room ? titleOfRoom(room) : 'Raum',
        to: officePlaces.room(duty.roomId),
        sub: property,
      }
    }

    if (duty.buildingId !== null) {
      return {
        name: maybeText(byId(buildings, duty.buildingId), 'name') ?? 'Gebäude',
        to: officePlaces.building(duty.buildingId),
        sub: property,
      }
    }

    return { name: property, to: officePlaces.property(duty.propertyId), sub: 'Liegenschaft' }
  }

  const chips = showsAreas ? (
    <div role="group" aria-label="Bereich" className="flex flex-wrap gap-1.5">
      <Chip
        pressed={area === null}
        onPress={() => {
          choose(null)
        }}
      >
        Alle Bereiche
      </Chip>
      {known.map((each) => (
        <Chip
          key={each.id}
          pressed={area?.id === each.id}
          onPress={() => {
            choose(each.id)
          }}
        >
          {each.name}
        </Chip>
      ))}
    </div>
  ) : null

  const where = area === null ? 'über alle Liegenschaften' : `im Bereich ${area.name}`

  return (
    <Screen>
      <PageHead
        title="Übersicht"
        sub={`Betreiberverantwortung ${where}${read === undefined ? '' : `, ${dayWords(read.today)}`}`}
        actions={chips}
      />
      {read === undefined ? (
        <Panel>
          <Empty>
            {overview.error instanceof RequestRefused && overview.error.status === 403
              ? overviewWords.refused
              : overview.isError
                ? overviewWords.failed
                : overview.fetchStatus === 'paused'
                  ? overviewWords.noConnection
                  : overviewWords.loading}
          </Empty>
        </Panel>
      ) : (
        <>
          <CountTiles
            label="Betreiberverantwortung in Zahlen"
            className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            tiles={tilesOf(read, inArea)}
          />
          <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <SoonTable read={read} inArea={inArea} whereOf={whereOf} />
            <div className="flex min-w-0 flex-col gap-3.5">
              <Panel title={overviewWords.neverRecorded}>
                <Rows
                  empty={overviewWords.noneNever}
                  more={read.neverRecorded - read.neverRecordedFirst.length}
                  moreTo={{
                    to: dutyRegisterPlace.to,
                    search: dutySearch({ state: 'never_recorded', ...inArea }),
                  }}
                  rows={read.neverRecordedFirst.map((duty) => ({
                    key: duty.id,
                    to: dutyPlaces.duty(duty.id),
                    title: duty.title,
                    sub: [duty.asset?.number, propertyOf(duty.propertyId)]
                      .filter(Boolean)
                      .join(', '),
                  }))}
                />
              </Panel>
              {read.defectsOverdue === null || read.defectsOverdueFirst === null ? null : (
                <Panel title={overviewWords.defects}>
                  <Rows
                    empty={overviewWords.noneDefects}
                    more={read.defectsOverdue - read.defectsOverdueFirst.length}
                    moreTo={{
                      to: defectListPlace.to,
                      search: defectSearch({ state: 'overdue', ...inArea }),
                    }}
                    rows={read.defectsOverdueFirst.map((defect) => defectRow(defect))}
                  />
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </Screen>
  )
}

/**
 * The numbers of the overview, each a link to the list it counts. A number
 * that is zero is drawn quiet, in the colour of the text: nothing calls for
 * attention there.
 */
function tilesOf(read: Overview, inArea: { readonly areaId?: string }): Tile[] {
  const toned = (value: number, tone: Tile['tone']) => (value === 0 ? 'neutral' : tone)
  const duties = (search: Readonly<Record<string, string>>) => ({
    to: dutyRegisterPlace.to,
    search,
  })
  const tiles: Tile[] = [
    {
      value: read.overdue,
      label: 'Überfällig',
      tone: toned(read.overdue, 'conflict'),
      sub: 'Termin verstrichen',
      ...duties(dutySearch({ state: 'overdue', ...inArea })),
    },
    {
      value: read.dueIn30Days,
      label: 'In 30 Tagen fällig',
      tone: toned(read.dueIn30Days, 'waiting'),
      ...duties(dutySearch({ due: 'in_30_days', ...inArea })),
    },
    {
      value: read.dueIn90Days,
      label: 'In 90 Tagen fällig',
      ...duties(dutySearch({ due: 'in_90_days', ...inArea })),
    },
    {
      value: read.neverRecorded,
      label: 'Nie erfasst',
      tone: toned(read.neverRecorded, 'conflict'),
      sub: 'Pflicht ohne Nachweis',
      ...duties(dutySearch({ state: 'never_recorded', ...inArea })),
    },
  ]

  if (read.reportsMissing !== null) {
    tiles.push({
      value: read.reportsMissing,
      label: 'Nachweis fehlt',
      tone: toned(read.reportsMissing, 'waiting'),
      sub: 'Fremdfirma, Bericht fehlt',
      to: activityListPlace.to,
      search: activitySearch({ state: 'report_missing', ...inArea }),
    })
  }

  if (read.defectsOverdue !== null) {
    tiles.push({
      value: read.defectsOverdue,
      label: 'Mängel über Frist',
      tone: toned(read.defectsOverdue, 'conflict'),
      to: defectListPlace.to,
      search: defectSearch({ state: 'overdue', ...inArea }),
    })
  }

  return tiles
}

/** The table of the overdue duties and those of the next 30 days, with the way to all of them in the register. */
function SoonTable({
  read,
  inArea,
  whereOf,
}: {
  readonly read: Overview
  readonly inArea: { readonly areaId?: string }
  readonly whereOf: (duty: OverviewDuty) => { name: string; to: string; sub: string }
}) {
  const all =
    read.soonTotal === 0 ? null : (
      <Link
        to={dutyRegisterPlace.to}
        search={dutySearch({ due: 'overdue_or_in_30_days', ...inArea })}
        className="text-[13px] text-copper-text underline underline-offset-2"
      >
        Alle {read.soonTotal.toLocaleString('de-DE')} im Pflichtenverzeichnis
      </Link>
    )
  const mark = (duty: OverviewDuty) => (
    <DutyStateMark state={duty.state} until={duty.appointment?.dueOn ?? null} />
  )

  return (
    <TablePanel
      title={overviewWords.soon}
      action={all}
      caption="Überfällige und in 30 Tagen fällige Pflichten mit Anlage und Liegenschaft, Termin und Zustand"
      cards={read.soon.map((duty) => {
        const where = whereOf(duty)

        return {
          key: duty.id,
          title: (
            <Link to={dutyPlaces.duty(duty.id)} className={cardLink}>
              {duty.title}
            </Link>
          ),
          sub: [where.name, where.sub, duty.appointment ? date(duty.appointment.dueOn) : null]
            .filter(Boolean)
            .join(' · '),
          right: mark(duty),
        }
      })}
      cardsEmpty={overviewWords.noneSoon}
    >
      <thead>
        <tr>
          <Column className="min-w-[160px]">Pflicht</Column>
          <Column className="w-[250px] min-w-[180px]">Anlage und Liegenschaft</Column>
          <Column numeric className="w-[86px]">
            Termin
          </Column>
          <Column className="w-[118px]">Zustand</Column>
        </tr>
      </thead>
      <tbody>
        {read.soon.length === 0 ? (
          <tr>
            <Cell colSpan={4} className="text-ink-muted">
              {overviewWords.noneSoon}
            </Cell>
          </tr>
        ) : (
          read.soon.map((duty) => {
            const where = whereOf(duty)

            return (
              <tr key={duty.id}>
                <Cell className="font-medium">
                  <Link to={dutyPlaces.duty(duty.id)}>{duty.title}</Link>
                </Cell>
                <Cell>
                  <div className="leading-[1.3]">
                    <div className="font-medium">
                      <Link to={where.to}>{where.name}</Link>
                    </div>
                    <div className="text-[12px] text-ink-faint">{where.sub}</div>
                  </div>
                </Cell>
                <Cell numeric>{duty.appointment ? date(duty.appointment.dueOn) : ''}</Cell>
                <Cell>{mark(duty)}</Cell>
              </tr>
            )
          })
        )}
      </tbody>
    </TablePanel>
  )
}

/** A defect as a row of its card: what it is, where and until when, and how it stands. */
function defectRow(defect: DefectEntry) {
  const place = [defect.place.propertyName, defect.place.buildingName].filter(Boolean).join(', ')

  return {
    key: defect.id,
    to: defectPlaces.defect(defect.id),
    title: defect.description,
    sub: defect.dueOn === null ? place : `${place}, Frist ${date(defect.dueOn)}`,
    right: <DefectStatusMark status={defect.status} />,
  }
}

/** The rows of a card at the side, `list_item()` of the boards, and the way to the rest of them. */
function Rows({
  rows,
  empty,
  more,
  moreTo,
}: {
  readonly rows: readonly {
    readonly key: string
    readonly to: string
    readonly title: string
    readonly sub: string
    readonly right?: ReactNode
  }[]
  readonly empty: string
  readonly more: number
  readonly moreTo: { readonly to: string; readonly search: Readonly<Record<string, string>> }
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-muted">{empty}</p>
  }

  return (
    <>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="border-b border-row">
            <Link to={row.to} className="flex items-center gap-2.5 py-2 text-ink no-underline">
              <span className="min-w-0 grow leading-[1.35]">
                <span className="block text-[13px] font-medium">{row.title}</span>
                <span className="block text-[12px] text-ink-faint">{row.sub}</span>
              </span>
              {row.right}
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <div className="pt-2">
          <Link
            to={moreTo.to}
            search={moreTo.search}
            className="text-[13px] text-copper-text underline underline-offset-2"
          >
            {more.toLocaleString('de-DE')} weitere
          </Link>
        </div>
      ) : null}
    </>
  )
}
