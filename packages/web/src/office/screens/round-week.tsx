import {
  addDays,
  type IsoDate,
  type RecordState,
  type RoundState,
  roundStateLabel,
  type RoundWeek,
  rhythmText,
  weekdayOf,
  weekdayShort,
  weekNamed,
  weekNumberOf,
  type WeekRound,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  IconButton,
  Panel,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, request, RequestRefused, text, useRecords } from '@opengewerk/platform-web/sync'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  ListChecks,
  PenLine,
  User,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { areaName, useAreas } from '../../session/areas.js'
import {
  planListPlace,
  planPlaces,
  roundPlaces,
  roundsPlace,
  templateListPlace,
} from '../round-template-addresses.js'
import { CountTiles } from './imports.js'
import { CloseRoundDialog, roundDate } from './round.js'
import { calendarOf, nameOf, performersQuery, roundPeopleQuery, walkerOf } from './round-plans.js'

/**
 * "Rundgänge", `rundgaenge()` of the boards (section 4.5 of the concept,
 * #113): which round of the plans is open, begun or handed in this week, by
 * building and not by person; who walks each, handed out per plan and week
 * or like the week before. A daily round makes seven passes in its row and
 * no list of the week with seven columns.
 *
 * Read from the server, which knows the state of the signatures; whoever
 * only performs is shown what is given to them or to nobody, as their device
 * holds it. Handing out is for whoever plans and hands out work (section 7).
 *
 * Each pass leads to its round (#115). A round of an earlier week that is
 * still open or begun stands under the week, each with its day, until
 * whoever plans closes it with the reason: it is not quietly gone.
 */

export const weekWords = {
  sub: 'Was in dieser Woche offen, begonnen und abgegeben ist, nach Gebäude',
  none: 'In dieser Woche ist kein Rundgang fällig. Rundgänge entstehen aus den Plänen.',
  failed: 'Die Rundgänge sind gerade nicht zu laden. Die Übersicht braucht eine Verbindung.',
  likeLastWeek: 'Wie letzte Woche zuteilen',
  handedOut: (handed: number, kept: number) =>
    `${String(handed)} ${handed === 1 ? 'Rundgang' : 'Rundgänge'} wie letzte Woche zugeteilt` +
    (kept > 0 ? `, ${String(kept)} ohne Rundgang in der Woche davor bleiben, wie sie sind.` : '.'),
  begunStays: 'Ein Rundgang, den schon jemand begonnen hat, bleibt bei dieser Person.',
  everybody: (area: string | null) =>
    `Alle im Bereich: Der Rundgang liegt auf den Geräten aller im Bereich${area ? ` ${area}` : ''}, die Vorgänge ausführen.`,
  openBefore: 'nicht still verschwunden',
  before: 'Offen aus vergangenen Wochen',
  beforeCaption: 'Die Rundgänge früherer Wochen, die noch offen oder begonnen sind',
  open: 'Öffnen',
  close: 'Schließen mit Grund',
} as const

/** How each state of a round looks in its chip, as `ROUND_STATES` of the boards. */
const chipLook: Readonly<
  Record<RoundState, { readonly className: string; readonly icon: typeof Check | null }>
> = {
  open: { className: 'text-ink-muted bg-surface border-control', icon: null },
  started: { className: 'text-waiting bg-waiting-fill border-waiting-edge', icon: PenLine },
  awaiting_countersignature: {
    className: 'text-waiting bg-waiting-fill border-waiting-edge',
    icon: Clock,
  },
  submitted: { className: 'text-done bg-done-fill border-done-edge', icon: Check },
  not_performed: { className: 'text-ink-muted bg-surface-sunken border-line', icon: Ban },
}

/** One round of the week: its day and its state, a link to the round. */
function RoundChip({ round }: { readonly round: WeekRound }) {
  const look = chipLook[round.state]
  const Icon = look.icon
  const day = weekdayShort[weekdayOf(round.dueOn)]

  return (
    <Link
      to={roundPlaces.round(round.id)}
      title={`${day}: ${roundStateLabel[round.state]}`}
      className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[3px] border px-[7px] text-[12px] font-semibold no-underline ${look.className}`}
    >
      {Icon ? <Icon size={12} strokeWidth={2.4} aria-hidden="true" /> : null}
      {day}
      <span className="font-medium">{roundStateLabel[round.state]}</span>
    </Link>
  )
}

/** "Woche 41, 05. bis 11.10.2026". */
function weekTitle(monday: IsoDate): string {
  const sunday = addDays(monday, 6)
  const first = date(monday)

  return `Woche ${String(weekNumberOf(monday))}, ${first.slice(0, first.lastIndexOf('.') - 2)} bis ${date(sunday)}`
}

/** A row of the week: one plan with its rounds. */
interface WeekRow {
  readonly planId: string
  readonly plan: RecordState | undefined
  readonly title: string
  readonly rhythm: string
  readonly building: string
  readonly property: string
  readonly areaId: string
  readonly rounds: readonly WeekRound[]
}

export function RoundWeekScreen() {
  const plans = useRight('activity.write')
  const navigate = useNavigate()
  const queries = useQueryClient()
  const address = useSearch({ strict: false }) as Readonly<Record<string, unknown>>
  const monday = weekNamed(address['woche']) ?? weekNamed(today()) ?? (today() as IsoDate)
  const [area, setArea] = useState<string | null>(null)
  const [handing, setHanding] = useState<WeekRow | null>(null)
  const [closing, setClosing] = useState<{ round: WeekRound; row: WeekRow } | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const areas = useAreas()
  const people = useQuery(roundPeopleQuery)
  const records = useRecords('round_plans')
  const templates = useRecords('round_templates')
  const buildings = useRecords('buildings')
  const properties = useRecords('properties')
  const week = useQuery({
    queryKey: ['rounds', 'week', monday],
    queryFn: () => request<RoundWeek>(`/rounds/week?of=${monday}`),
    placeholderData: keepPreviousData,
  })

  const rowOf = useMemo(
    () =>
      (planId: string, rounds: readonly WeekRound[]): WeekRow => {
        const plan = records.find((each) => each['id'] === planId)
        const building = buildings.find((each) => each['id'] === plan?.['buildingId'])
        const property = properties.find((each) => each['id'] === plan?.['propertyId'])

        return {
          planId,
          plan,
          title:
            maybeText(
              templates.find((each) => each['id'] === plan?.['templateId']),
              'title',
            ) ?? 'Rundgang',
          rhythm: plan ? rhythmText(calendarOf(plan)) : '',
          building: maybeText(building, 'name') ?? maybeText(property, 'name') ?? 'Ort',
          property: building ? (maybeText(property, 'name') ?? '') : 'ganze Liegenschaft',
          areaId: text(plan, 'areaId'),
          rounds,
        }
      },
    [records, templates, buildings, properties],
  )

  const rows = useMemo(() => {
    const byPlan = new Map<string, WeekRound[]>()

    for (const round of week.data?.rounds ?? []) {
      byPlan.set(round.planId, [...(byPlan.get(round.planId) ?? []), round])
    }

    return [...byPlan.entries()]
      .map(([planId, rounds]) => rowOf(planId, rounds))
      .filter((row) => area === null || row.areaId === area)
      .sort(
        (left, right) =>
          left.property.localeCompare(right.property, 'de') ||
          left.building.localeCompare(right.building, 'de') ||
          left.title.localeCompare(right.title, 'de'),
      )
  }, [week.data, rowOf, area])

  // Each round from before on a row of its own, the latest first, as the server orders them.
  const before = useMemo(
    () =>
      (week.data?.before ?? [])
        .map((round) => ({ round, row: rowOf(round.planId, [round]) }))
        .filter(({ row }) => area === null || row.areaId === area),
    [week.data, rowOf, area],
  )

  const shown = rows.flatMap((row) => row.rounds)
  const counted = (state: RoundState) => shown.filter((round) => round.state === state).length
  const go = (to: IsoDate) => {
    void navigate({ to: roundsPlace.to, search: { woche: to }, replace: true })
  }

  async function likeLastWeek() {
    setSaid(null)
    setWorking(true)

    try {
      const answer = await request<{ handedOut: number; kept: number }>('/rounds/like-last-week', {
        method: 'POST',
        body: JSON.stringify({ weekOf: monday }),
      })

      setSaid(weekWords.handedOut(answer.handedOut, answer.kept))
      await queries.invalidateQueries({ queryKey: ['rounds'] })
    } catch (error) {
      setSaid(error instanceof RequestRefused ? error.message : weekWords.failed)
    } finally {
      setWorking(false)
    }
  }

  const chip = (label: string, value: string | null) => (
    <button
      key={value ?? 'all'}
      type="button"
      aria-pressed={area === value}
      className={
        area === value
          ? 'h-8 rounded-[4px] border border-ink bg-ink px-3 text-[13px] font-semibold text-surface'
          : 'h-8 rounded-[4px] border border-control bg-surface px-3 text-[13px] text-ink'
      }
      onClick={() => {
        setArea(value)
      }}
    >
      {label}
    </button>
  )

  let body: ReactNode

  if (week.isError && week.data === undefined) {
    body = (
      <Panel>
        <Empty>{weekWords.failed}</Empty>
      </Panel>
    )
  } else if (rows.length === 0) {
    body = (
      <Panel>
        <Empty>{week.isPending ? 'Die Rundgänge der Woche werden geladen.' : weekWords.none}</Empty>
      </Panel>
    )
  } else {
    body = (
      <TablePanel
        title="Diese Woche"
        caption="Die Rundgänge der Woche nach Gebäude, mit ihren Durchgängen und wer sie geht"
        cards={rows.map((row) => ({
          key: row.planId,
          title: <Link to={planPlaces.plan(row.planId)}>{row.title}</Link>,
          // On a phone the passes stand under the place, each with its state.
          sub: (
            <span className="flex flex-col gap-1.5">
              <span>
                {row.building}, {row.property}
              </span>
              <span className="flex flex-wrap gap-1">
                {row.rounds.map((round) => (
                  <RoundChip key={round.id} round={round} />
                ))}
              </span>
              <span>{walkersOf(row, people.data, areaName(areas, row.areaId))}</span>
            </span>
          ),
          ...(plans
            ? {
                actions: (
                  <Button
                    size="small"
                    icon={User}
                    onClick={() => {
                      setHanding(row)
                    }}
                  >
                    Zuteilen
                  </Button>
                ),
              }
            : {}),
        }))}
      >
        <thead>
          <tr>
            <Column className="w-[170px]">Gebäude</Column>
            <Column className="w-[190px]">Rundgang</Column>
            <Column>Durchgänge</Column>
            <Column className="w-[150px]">Zuständig</Column>
            {plans ? (
              <Column className="w-[104px]">
                <span className="sr-only">Zuteilen</span>
              </Column>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.planId}>
              <Cell>
                <div className="leading-[1.32]">
                  <div className="font-medium">{row.building}</div>
                  <div className="text-[12px] text-ink-faint">{row.property}</div>
                </div>
              </Cell>
              <Cell>
                <div className="leading-[1.32]">
                  <Link to={planPlaces.plan(row.planId)} className="font-medium">
                    {row.title}
                  </Link>
                  <div className="text-[12px] text-ink-faint">{row.rhythm}</div>
                </div>
              </Cell>
              <Cell>
                <div className="flex flex-wrap gap-1">
                  {row.rounds.map((round) => (
                    <RoundChip key={round.id} round={round} />
                  ))}
                </div>
              </Cell>
              <Cell>{walkersOf(row, people.data, areaName(areas, row.areaId))}</Cell>
              {plans ? (
                <Cell>
                  <Button
                    size="small"
                    icon={User}
                    onClick={() => {
                      setHanding(row)
                    }}
                  >
                    Zuteilen
                  </Button>
                </Cell>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TablePanel>
    )
  }

  return (
    <Screen>
      <PageHead
        title={roundsPlace.label}
        sub={weekWords.sub}
        actions={
          <>
            <Button
              icon={FileText}
              onClick={() => {
                void navigate({ to: templateListPlace.to })
              }}
            >
              Vorlagen
            </Button>
            <Button
              icon={ListChecks}
              onClick={() => {
                void navigate({ to: planListPlace.to })
              }}
            >
              Pläne
            </Button>
            {plans ? (
              <Button
                tone="primary"
                icon={Copy}
                disabled={working}
                onClick={() => {
                  void likeLastWeek()
                }}
              >
                {weekWords.likeLastWeek}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton
            label="Vorige Woche"
            tone="secondary"
            onClick={() => {
              go(addDays(monday, -7))
            }}
          >
            <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          </IconButton>
          <span className="min-w-0 text-center text-[14px] font-semibold sm:min-w-[220px]">
            {weekTitle(monday)}
          </span>
          <IconButton
            label="Nächste Woche"
            tone="secondary"
            onClick={() => {
              go(addDays(monday, 7))
            }}
          >
            <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="grow" />
        {areas.length > 1 ? (
          <div role="group" aria-label="Bereiche" className="flex flex-wrap gap-1.5">
            {chip('Alle Bereiche', null)}
            {areas.map((each) => chip(each.name, each.id))}
          </div>
        ) : null}
      </div>
      {said ? (
        <p role="status" className="text-[13px] font-medium text-ink-muted">
          {said}
        </p>
      ) : null}
      <CountTiles
        label="Rundgänge der Woche nach Stand"
        tiles={[
          { value: counted('open'), label: roundStateLabel.open },
          { value: counted('started'), label: roundStateLabel.started, tone: 'waiting' },
          {
            value: counted('awaiting_countersignature'),
            label: roundStateLabel.awaiting_countersignature,
            tone: 'waiting',
          },
          { value: counted('submitted'), label: roundStateLabel.submitted, tone: 'done' },
          {
            value: before.length,
            label: 'Offen aus Vorwochen',
            tone: 'conflict',
            sub: weekWords.openBefore,
          },
        ]}
      />
      {body}
      {before.length > 0 ? (
        <TablePanel
          title={weekWords.before}
          caption={weekWords.beforeCaption}
          cards={before.map(({ round, row }) => ({
            key: round.id,
            title: <Link to={roundPlaces.round(round.id)}>{row.title}</Link>,
            sub: (
              <span className="flex flex-col gap-1">
                <span>{placeOf(row)}</span>
                <span>{roundDate(round.dueOn)}</span>
                <span>
                  {walkerOf(people.data, round.performerUserId, areaName(areas, row.areaId))}
                </span>
              </span>
            ),
            ...(plans
              ? {
                  actions: (
                    <Button
                      size="small"
                      icon={Ban}
                      onClick={() => {
                        setClosing({ round, row })
                      }}
                    >
                      {weekWords.close}
                    </Button>
                  ),
                }
              : {}),
          }))}
        >
          <thead>
            <tr>
              <Column>Rundgang</Column>
              <Column className="w-[200px]">Fällig war</Column>
              <Column className="w-[160px]">Zuständig</Column>
              <Column className="w-[230px]">
                <span className="sr-only">Öffnen oder schließen</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {before.map(({ round, row }) => (
              <tr key={round.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <Link to={roundPlaces.round(round.id)} className="font-medium">
                      {row.title}
                    </Link>
                    <div className="text-[12px] text-ink-faint">{placeOf(row)}</div>
                  </div>
                </Cell>
                <Cell>{roundDate(round.dueOn)}</Cell>
                <Cell>
                  {walkerOf(people.data, round.performerUserId, areaName(areas, row.areaId))}
                </Cell>
                <Cell>
                  <div className="flex justify-end gap-[5px]">
                    <Button
                      size="small"
                      onClick={() => {
                        void navigate({ to: roundPlaces.round(round.id) })
                      }}
                    >
                      {weekWords.open}
                    </Button>
                    {plans ? (
                      <Button
                        size="small"
                        onClick={() => {
                          setClosing({ round, row })
                        }}
                      >
                        {weekWords.close}
                      </Button>
                    ) : null}
                  </div>
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      ) : null}
      {closing ? (
        <CloseRoundDialog
          round={{ id: closing.round.id, title: closing.row.title, dueOn: closing.round.dueOn }}
          sub={placeOf(closing.row)}
          onClose={() => {
            setClosing(null)
          }}
        />
      ) : null}
      {handing ? (
        <HandOutDialog
          row={handing}
          monday={monday}
          area={areaName(areas, handing.areaId)}
          onClose={() => {
            setHanding(null)
          }}
          onDone={async () => {
            setHanding(null)
            await queries.invalidateQueries({ queryKey: ['rounds'] })
          }}
        />
      ) : null}
    </Screen>
  )
}

/** Where the rounds of a row are walked: "Feuerwache Nord, Wache", or the property as a whole. */
function placeOf(row: WeekRow): string {
  return row.plan?.['buildingId']
    ? `${row.property}, ${row.building}`
    : `${row.building}, ${row.property}`
}

/** Who walks the rounds of a row, each once: "Murat Yilmaz, Lena Vogt". */
function walkersOf(
  row: WeekRow,
  people: Parameters<typeof walkerOf>[0],
  area: string | null,
): string {
  return [
    ...new Set(row.rounds.map((round) => walkerOf(people, round.performerUserId, area))),
  ].join(', ')
}

/**
 * Handing out the rounds of one plan in one week, `rundgaenge_zuteilen()` of
 * the boards: each round to one of the own people who perform in the area,
 * or to everybody there. A round that was begun keeps its person.
 */
function HandOutDialog({
  row,
  monday,
  area,
  onClose,
  onDone,
}: {
  readonly row: WeekRow
  readonly monday: IsoDate
  readonly area: string | null
  readonly onClose: () => void
  readonly onDone: () => Promise<void>
}) {
  const performers = useQuery(performersQuery(row.areaId))
  const people = useQuery(roundPeopleQuery)
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(row.rounds.map((round) => [round.id, round.performerUserId ?? ''])),
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const everybody = `Alle im Bereich${area ? ` ${area}` : ''}`

  async function save() {
    const changed = row.rounds.filter(
      (round) =>
        round.state === 'open' && (chosen[round.id] ?? '') !== (round.performerUserId ?? ''),
    )

    if (changed.length === 0) {
      onClose()

      return
    }

    setTrouble(null)
    setWorking(true)

    try {
      await request('/rounds/assignment', {
        method: 'PUT',
        body: JSON.stringify({
          rounds: changed.map((round) => ({
            id: round.id,
            performerUserId: chosen[round.id] === '' ? null : chosen[round.id],
          })),
        }),
      })
      await onDone()
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : weekWords.failed)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title={`Zuteilen: ${row.title}`} sub={weekTitle(monday)} width={520} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="text-[12px] leading-[1.4] text-ink-muted">
          {row.building}, {row.property}. {weekWords.begunStays}
        </p>
        <ul className="flex flex-col">
          {row.rounds.map((round) => {
            const day = `${weekdayShort[weekdayOf(round.dueOn)]} ${date(round.dueOn).slice(0, 6)}`
            const person = chosen[round.id] ?? ''
            const options = [
              ...(performers.data ?? []).map((each) => ({ value: each.userId, label: each.name })),
              ...(person !== '' && !(performers.data ?? []).some((each) => each.userId === person)
                ? [{ value: person, label: nameOf(people.data, person) }]
                : []),
              { value: '', label: everybody },
            ]

            return (
              <li
                key={round.id}
                className="flex items-center gap-3 border-b border-line-row py-[7px]"
              >
                <span className="w-[90px] text-[14px] font-medium">{day}</span>
                <div className="grow" />
                {round.state === 'open' ? (
                  // Named by the day it stands beside, with the arrow of the
                  // canvas as `SelectField` draws it.
                  <div className="relative w-[230px] max-sm:w-[190px]">
                    <select
                      aria-label={day}
                      value={person}
                      disabled={working}
                      className="h-control-lg min-h-tap w-full cursor-pointer appearance-none rounded-control border border-line-strong bg-input pr-[30px] pl-2.5 text-body text-ink"
                      onChange={(event) => {
                        setChosen((before) => ({ ...before, [round.id]: event.target.value }))
                      }}
                    >
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={15}
                      strokeWidth={2.2}
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 right-[9px] -translate-y-1/2 text-ink-muted"
                    />
                  </div>
                ) : (
                  <span className="text-[13px] text-ink-muted">
                    {walkerOf(people.data, round.performerUserId, area)},{' '}
                    {roundStateLabel[round.state].toLowerCase()}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-[12px] leading-[1.4] text-ink-muted">{weekWords.everybody(area)}</p>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            {working ? 'Einen Moment' : 'Zuteilen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
