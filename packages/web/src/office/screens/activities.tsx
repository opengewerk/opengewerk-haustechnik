import {
  type ActivityCandidates,
  activityClosable,
  type ActivityDetails,
  type ActivityEntry,
  type ActivityList,
  activityKindLabel,
  type ActivityListState,
  activityListStateLabel,
  activityListStates,
  activityLimits,
  activityPlanProblems,
  activityProblems,
  type ActivityStatus,
  activityStatusLabel,
  dueActivityKinds,
  type DutyPerformer,
  type DutyPerson,
  intervalWords,
  qualificationLevelLabel,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Choice,
  Column,
  Dialog,
  DialogActions,
  Field,
  Panel,
  SelectField,
  Status,
  statusIcons,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Chip,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Saved,
  Screen,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  Ban,
  Check,
  Clock,
  type LucideIcon,
  Pencil,
  SearchCheck,
  Signature,
  Upload,
} from 'lucide-react'
import { type ReactNode, useDeferredValue, useId, useMemo, useState } from 'react'

import { DutyStateMark } from '../../app/asset-marks.js'
import { titleOfRoom } from '../../app/place-records.js'
import { askAt } from '../../sync/made-at.js'
import {
  activityFilterOf,
  type ActivityListAddress,
  activityListPlace,
  activityListRequest,
  activityPlaces,
  activitySearch,
} from '../activity-addresses.js'
import { dutyPlaces, evidencePlaces } from '../duty-addresses.js'
import { ResultMark } from '../evidence-words.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { RegisterFilter } from '../register-filter.js'

export const activityWords = {
  sub: 'Prüfungen und Wartungen aus den fälligen Terminen der Pflichten, nach dem Tag, an dem sie fällig sind.',
  searchLabel: 'Prüfungen durchsuchen',
  searchPlaceholder: 'Pflicht, Anlage, Liegenschaft …',
  note: 'Ein Vorgang entsteht, wenn der Vorlauf eines Termins beginnt, einmal je Termin; läuft für eine Pflicht keiner, wird einer auf ihrer Seite angelegt. Der Termin rückt erst mit dem Nachweis weiter, nie mit dem Anlegen oder Planen des Vorgangs.',
  noConnection: 'Die Prüfungen kommen vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Prüfungen werden geladen.',
  failed: 'Die Prüfungen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  nothingPasses: 'Keine Prüfung und keine Wartung passt zu dem, wonach die Liste eingegrenzt ist.',
  none: 'Noch gibt es keine Prüfung und keine Wartung. Sie entstehen von selbst, wenn der Vorlauf eines Termins beginnt.',
  nobody: 'noch niemand',
  nobodyNamed: 'Niemand benannt',
  contractor: 'Fremdfirma',
  late: 'überfällig',
  notThere:
    'Diesen Vorgang gibt es nicht, oder er liegt außerhalb dessen, was dieser Zugang sieht.',
  pageNoConnection: 'Ein Vorgang kommt vom Server. Gerade ist keine Verbindung da.',
  pageLoading: 'Der Vorgang wird geladen.',
  pageFailed: 'Der Vorgang ließ sich nicht laden. Er kommt vom Server, mit Verbindung.',
  ownNote:
    'Das Protokoll aus dem Paket der Anlagenart, ausgefüllt vor Ort, mit Messwerten und Unterschrift',
  foreignNote:
    'Termin mit einer Fremdfirma, danach Bericht oder Prüfbescheinigung im Büro eintragen',
  stepDevice:
    'Wer ausführt, hat die Prüfung nach dem nächsten Abgleich auf dem Gerät, solange sie offen ist.',
  stepSignature:
    'Mit der Unterschrift entsteht der Nachweis, der Vorgang ist erledigt und der Termin rückt weiter.',
  stepContractor: 'Die Fremdfirma prüft an dem Tag, der mit ihr vereinbart ist.',
  stepReport:
    'Ihren Bericht trägt das Büro unter „Bericht eintragen“ ein. Mit ihm entsteht der Nachweis, der Vorgang ist erledigt und der Termin rückt weiter.',
  stays:
    'Der Termin rückt erst mit dem Nachweis weiter und nie mit dem Anlegen des Vorgangs: eine Prüfung, die geplant und nicht durchgeführt wurde, bleibt überfällig.',
  peopleFailed: 'Wer zur Wahl steht, ließ sich nicht laden. Das braucht eine Verbindung.',
  noneYet: 'noch keines',
  closingHint: 'Der Grund steht am Vorgang und bleibt lesbar.',
  whatClosingDoes:
    'Der Vorgang ist damit geschlossen, auch auf den Geräten, und lässt sich nicht wieder öffnen. Der Termin der Pflicht bleibt, wie er ist: ohne Nachweis wird sie überfällig. Einen neuen Vorgang legt an, wer plant und verteilt, auf der Seite der Pflicht.',
} as const

/** The way a state is drawn, `status()` of the boards: in words, in a tone and with a symbol of its own. */
const statusLooks: Readonly<Record<ActivityStatus, { tone: StatusTone; icon?: LucideIcon }>> = {
  open: { tone: 'neutral', icon: Clock },
  started: { tone: 'waiting', icon: Pencil },
  signed: { tone: 'waiting', icon: Signature },
  done: { tone: 'done', icon: Check },
  not_performed: { tone: 'neutral', icon: statusIcons.ban },
}

export function ActivityStatusMark({ status }: { readonly status: ActivityStatus }) {
  const look = statusLooks[status]

  return (
    <Status tone={look.tone} {...(look.icon ? { icon: look.icon } : {})}>
      {activityStatusLabel[status]}
    </Status>
  )
}

/** A page of the list from the server, and the page of one activity. */
export function activityQuery(id: string) {
  return {
    queryKey: ['activities', 'page', id],
    queryFn: () => request<ActivityDetails>(`/activities/${id}`),
  } as const
}

function candidatesQuery(id: string) {
  return {
    queryKey: ['activities', 'candidates', id],
    queryFn: () => request<ActivityCandidates>(`/activities/${id}/candidates`),
  } as const
}

/** Where an activity is: the asset, the room, the building or the property, and below it where that is. */
interface Where {
  readonly name: string
  readonly to: string
  readonly sub: string
  /** The property and the building, "Ort" on the page of the activity. */
  readonly line: string
}

/** Reads the places of an activity from the device, as the places of the person are all there. */
function usePlaces() {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')

  return useMemo(() => {
    const byId = (records: readonly RecordState[], id: string | null) =>
      id === null ? null : (records.find((record) => record['id'] === id) ?? null)

    return (activity: ActivityEntry): Where => {
      const property = maybeText(byId(properties, activity.propertyId), 'name') ?? 'Liegenschaft'
      const room = byId(rooms, activity.roomId)
      const asset = byId(assets, activity.assetId)
      const buildingId =
        activity.buildingId ??
        (asset ? maybeText(asset, 'buildingId') : null) ??
        (room ? maybeText(room, 'buildingId') : null)
      const building = maybeText(byId(buildings, buildingId), 'name')
      const line = [property, building].filter(Boolean).join(', ')

      if (activity.assetId !== null) {
        return {
          name:
            [maybeText(asset, 'number'), maybeText(asset, 'name')].filter(Boolean).join(' ') ||
            'Anlage',
          to: officePlaces.asset(activity.assetId),
          sub: line,
          line,
        }
      }

      if (activity.roomId !== null) {
        return { name: titleOfRoom(room), to: officePlaces.room(activity.roomId), sub: line, line }
      }

      if (activity.buildingId !== null) {
        return {
          name: building ?? 'Gebäude',
          to: officePlaces.building(activity.buildingId),
          sub: property,
          line,
        }
      }

      return {
        name: property,
        to: officePlaces.property(activity.propertyId),
        sub: 'Liegenschaft',
        line,
      }
    }
  }, [properties, buildings, rooms, assets])
}

/** Who performs an activity: the person, or the contractor in words, or nobody yet. */
function performerOf(activity: ActivityEntry): { main: ReactNode; sub: string | null } {
  if (activity.performer === 'contractor') {
    return {
      main: activity.contractorNote ?? activityWords.contractor,
      sub: activity.contractorNote === null ? null : activityWords.contractor,
    }
  }

  return activity.performerPerson === null
    ? { main: <span className="text-ink-faint">{activityWords.nobody}</span>, sub: null }
    : { main: activity.performerPerson.name, sub: null }
}

/** Whether an activity still to be done is past the day it is due on. */
function isLate(activity: Pick<ActivityEntry, 'dueOn' | 'status'>): boolean {
  return (
    activity.dueOn !== null &&
    activity.dueOn < today() &&
    (activity.status === 'open' || activity.status === 'started' || activity.status === 'signed')
  )
}

function DueCell({ activity }: { readonly activity: ActivityEntry }) {
  if (activity.dueOn === null) {
    return <span className="text-ink-faint">{activityWords.nobody}</span>
  }

  return isLate(activity) ? (
    <div className="leading-[1.32]">
      <div className="font-semibold text-conflict">{date(activity.dueOn)}</div>
      <div className="text-[12px] text-conflict">{activityWords.late}</div>
    </div>
  ) : (
    <span>{date(activity.dueOn)}</span>
  )
}

/** Two lines in a cell, `lines()` of the boards: the thing, and below it in small print what it is. */
function TwoLines({
  main,
  sub,
  bold = false,
}: {
  readonly main: ReactNode
  readonly sub: ReactNode
  readonly bold?: boolean
}) {
  return (
    <div className="leading-[1.32]">
      <div className={bold ? 'font-medium' : undefined}>{main}</div>
      {sub === null || sub === '' ? null : <div className="text-[12px] text-ink-faint">{sub}</div>}
    </div>
  )
}

/** "14 offen", "3 erledigt": how many the list holds in the state it shows. */
const countWords: Readonly<Record<ActivityListState, string>> = {
  pending: 'offen',
  done: 'erledigt',
  not_performed: 'nicht durchgeführt',
  all: 'insgesamt',
}

/**
 * "Prüfungen" in the office, the board "Prüfungen und Wartungen" (4.4 of the
 * concept, #105): the inspections and the maintenance that came of the due
 * days of the duties, the earliest due day first, with where each is, who
 * answers for it, who performs it and how far it is.
 *
 * The list comes from the server a page at a time and is narrowed there; it
 * needs a connection and says so without one. Whoever plans and hands out
 * work sees every activity in their areas; whoever only performs sees what
 * is given to them or to nobody, as their device holds it. There is no
 * narrowing to a person: a list about somebody would count their work.
 */
export function ActivityListScreen() {
  const address = useSearch({ strict: false })
  const filter = useMemo(() => activityFilterOf(address), [address])
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const whereOf = usePlaces()
  const [search, setSearch] = useState('')
  const wanted = useDeferredValue(search.trim())
  const state = filter.state ?? 'pending'

  const pages = useInfiniteQuery({
    queryKey: ['activities', 'list', filter, wanted],
    queryFn: ({ pageParam }) =>
      request<ActivityList>(activityListRequest(filter, wanted, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.more ? all.reduce((sum, page) => sum + page.activities.length, 0) : undefined,
    placeholderData: keepPreviousData,
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  const first = pages.data?.pages[0]
  const activities = pages.data?.pages.flatMap((page) => page.activities) ?? []
  const narrowed = Object.keys(filter).some((name) => name !== 'state') || wanted !== ''

  /** The filter with one part set, or without it for the choice "all". */
  const set = (name: keyof ActivityListAddress, value: string) => {
    const { [name]: _, ...rest } = filter

    void navigate({
      to: activityListPlace.to,
      search: activitySearch(value === '' ? rest : { ...rest, [name]: value }),
      replace: true,
    })
  }
  const propertyChoices = properties
    .map((property) => ({
      value: String(property['id']),
      label: maybeText(property, 'name') ?? '',
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))

  return (
    <Screen>
      <PageHead
        title="Prüfungen"
        sub={activityWords.sub}
        {...(first === undefined
          ? {}
          : { count: `${first.total.toLocaleString('de-DE')} ${countWords[state]}` })}
      />
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <label className="sr-only" htmlFor="activity-search">
          {activityWords.searchLabel}
        </label>
        <input
          id="activity-search"
          type="search"
          value={search}
          placeholder={activityWords.searchPlaceholder}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
          className="h-8 w-[240px] rounded-control border border-line-strong bg-surface px-2.5 text-[14px] text-ink max-lg:h-10 max-lg:w-full"
        />
        <div role="group" aria-label="Stand" className="flex flex-wrap gap-1.5">
          {activityListStates.map((each) => (
            <Chip
              key={each}
              pressed={state === each}
              onPress={() => {
                set('state', each === 'pending' ? '' : each)
              }}
            >
              {activityListStateLabel[each]}
            </Chip>
          ))}
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5 max-lg:w-full">
          <RegisterFilter
            label="Art"
            className="lg:w-[150px]"
            value={filter.kind ?? ''}
            onChange={(value) => {
              set('kind', value)
            }}
          >
            <option value="">Alle Arten</option>
            {dueActivityKinds.map((kind) => (
              <option key={kind} value={kind}>
                {activityKindLabel[kind]}
              </option>
            ))}
          </RegisterFilter>
          <RegisterFilter
            label="Liegenschaft"
            className="lg:w-[200px]"
            value={filter.propertyId ?? ''}
            onChange={(value) => {
              set('propertyId', value)
            }}
          >
            <option value="">Alle Liegenschaften</option>
            {propertyChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
            {filter.propertyId !== undefined &&
            !propertyChoices.some((choice) => choice.value === filter.propertyId) ? (
              <option value={filter.propertyId}>Eine Liegenschaft</option>
            ) : null}
          </RegisterFilter>
        </div>
      </div>
      {first === undefined ? (
        <Panel>
          <Empty>
            {pages.isError
              ? activityWords.failed
              : pages.fetchStatus === 'paused'
                ? activityWords.noConnection
                : activityWords.loading}
          </Empty>
        </Panel>
      ) : activities.length === 0 ? (
        <Panel>
          <Empty>
            {narrowed || state !== 'pending' ? activityWords.nothingPasses : activityWords.none}
          </Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Prüfungen und Wartungen mit Fälligkeit, Anlage oder Ort, Zuständigkeit und Stand"
          note={activityWords.note}
          cards={activities.map((activity) => {
            const where = whereOf(activity)
            const performer = performerOf(activity)

            return {
              key: activity.id,
              title: (
                <Link to={activityPlaces.activity(activity.id)} className={cardLink}>
                  {activity.title}
                </Link>
              ),
              sub: [
                activity.dueOn === null ? null : date(activity.dueOn),
                where.name,
                activity.responsible?.name,
                typeof performer.main === 'string' ? performer.main : null,
              ]
                .filter((part) => part !== null && part !== undefined && part !== '')
                .join(' · '),
              right: <ActivityStatusMark status={activity.status} />,
            }
          })}
          footer={
            <>
              <span>
                {`${activities.length.toLocaleString('de-DE')} von ${first.total.toLocaleString('de-DE')}`}
              </span>
              <span className="grow" />
              {pages.hasNextPage ? (
                <Button
                  size="small"
                  disabled={pages.isFetchingNextPage}
                  onClick={() => {
                    void pages.fetchNextPage()
                  }}
                >
                  Weitere laden
                </Button>
              ) : null}
            </>
          }
        >
          <thead>
            <tr>
              <Column className="w-[100px] min-w-[96px]">Fällig am</Column>
              <Column className="min-w-[180px]">Vorgang</Column>
              <Column className="w-[236px] min-w-[160px]">Anlage und Ort</Column>
              <Column className="w-[120px] min-w-[110px]">Verantwortlich</Column>
              <Column className="w-[170px] min-w-[130px]">Ausführend</Column>
              <Column className="w-[150px] min-w-[130px]">Stand</Column>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => {
              const where = whereOf(activity)
              const performer = performerOf(activity)

              return (
                <tr key={activity.id}>
                  <Cell>
                    <DueCell activity={activity} />
                  </Cell>
                  <Cell>
                    <TwoLines
                      bold
                      main={
                        <Link to={activityPlaces.activity(activity.id)} className={factLink}>
                          {activity.title}
                        </Link>
                      }
                      sub={activityKindLabel[activity.kind]}
                    />
                  </Cell>
                  <Cell>
                    <TwoLines main={<Link to={where.to}>{where.name}</Link>} sub={where.sub} />
                  </Cell>
                  <Cell>
                    {activity.responsible?.name ?? (
                      <span className="text-ink-faint">{activityWords.nobody}</span>
                    )}
                  </Cell>
                  <Cell>
                    <TwoLines
                      main={performer.main}
                      sub={performer.sub}
                      bold={performer.sub !== null}
                    />
                  </Cell>
                  <Cell>
                    <ActivityStatusMark status={activity.status} />
                  </Cell>
                </tr>
              )
            })}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

/**
 * The page of an activity, `pruefung()` of the boards (4.4 of the concept,
 * #105): the duties it is to meet with how each stands and what came of it,
 * how it is performed and by whom, the day it is due on, and where it came
 * from. Whoever plans and hands out work changes the plan while the activity
 * is open; anybody else reads it. Planning moves no due day.
 */
export function ActivityScreen() {
  const { activityId } = useParams({ strict: false }) as { activityId?: string }
  const page = useQuery({ ...activityQuery(activityId ?? ''), enabled: activityId !== undefined })
  const shown = page.data
  const whereOf = usePlaces()
  const plans = useRight('activity.write')
  const entersEvidence = useRight('evidence.write')
  const navigate = useNavigate()
  const formId = useId()
  const [closing, setClosing] = useState(false)

  if (shown === undefined || activityId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Prüfung'}
          crumbs={[activityListPlace]}
          phoneBack={activityListPlace}
        />
        <Empty>
          {gone
            ? activityWords.notThere
            : page.isError
              ? activityWords.pageFailed
              : page.fetchStatus === 'paused'
                ? activityWords.pageNoConnection
                : activityWords.pageLoading}
        </Empty>
      </Screen>
    )
  }

  const where = whereOf(shown)
  const planning = plans && shown.status === 'open'
  // Closed with the reason before its signature, by whoever plans (#183).
  const closable =
    plans &&
    (dueActivityKinds as readonly string[]).includes(shown.kind) &&
    (activityClosable as readonly string[]).includes(shown.status)
  // A report meets one duty (#110): offered while the activity is open and
  // not for the own people, for a duty that takes one.
  const [only] = shown.duties
  const reportFor =
    entersEvidence &&
    shown.status === 'open' &&
    shown.performer !== 'own_staff' &&
    shown.duties.length === 1 &&
    only !== undefined &&
    only.takesReport &&
    only.result === null
      ? only.dutyId
      : null
  const lastMet = shown.duties
    .map((duty) => duty.lastMetOn)
    .filter((day) => day !== null)
    .sort()
    .at(-1)
  const qualifications = [
    ...new Set(
      shown.duties.flatMap((duty) =>
        duty.qualification === null ? [] : [qualificationLevelLabel[duty.qualification]],
      ),
    ),
  ]

  return (
    <Screen>
      <PageHead
        title={shown.title}
        crumbs={[activityListPlace]}
        phoneBack={activityListPlace}
        badges={
          <>
            <ActivityStatusMark status={shown.status} />
            <Status tone="neutral" icon={SearchCheck}>
              {activityKindLabel[shown.kind]}
            </Status>
          </>
        }
        actions={
          <>
            <ChangesButton table="activities" id={shown.id} />
            {reportFor === null ? null : (
              <Button
                icon={Upload}
                onClick={() => {
                  void navigate({ to: evidencePlaces.report(reportFor) })
                }}
              >
                Bericht eintragen
              </Button>
            )}
            {closable ? (
              <Button
                icon={Ban}
                onClick={() => {
                  setClosing(true)
                }}
              >
                Nicht durchgeführt
              </Button>
            ) : null}
            {planning ? (
              <Button type="submit" form={formId} tone="primary" icon={Check}>
                Speichern
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <TablePanel
            title="Pflichten dieses Vorgangs"
            caption="Pflichten dieses Vorgangs"
            cards={shown.duties.map((duty) => ({
              key: duty.id,
              title: (
                <Link to={dutyPlaces.duty(duty.dutyId)} className={cardLink}>
                  {duty.title}
                </Link>
              ),
              sub: [duty.appointment === null ? null : date(duty.appointment), where.name]
                .filter(Boolean)
                .join(' · '),
              right:
                duty.result === null ? (
                  <DutyStateMark state={duty.state} until={duty.appointment} />
                ) : (
                  <ResultMark result={duty.result} />
                ),
            }))}
          >
            <thead>
              <tr>
                <Column className="min-w-[140px]">Pflicht</Column>
                <Column className="w-[190px] min-w-[130px]">Anlage oder Ort</Column>
                <Column numeric className="w-[90px] min-w-[84px]">
                  Termin
                </Column>
                <Column className="w-[110px] min-w-[100px]">Zustand</Column>
                <Column className="w-[110px] min-w-[100px]">Ergebnis</Column>
              </tr>
            </thead>
            <tbody>
              {shown.duties.map((duty) => (
                <tr key={duty.id}>
                  <Cell>
                    <TwoLines
                      bold
                      main={
                        <Link to={dutyPlaces.duty(duty.dutyId)} className={factLink}>
                          {duty.title}
                        </Link>
                      }
                      sub={[
                        duty.source,
                        duty.interval === null ? null : intervalWords(duty.interval),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  </Cell>
                  <Cell>
                    <TwoLines main={<Link to={where.to}>{where.name}</Link>} sub={where.sub} />
                  </Cell>
                  <Cell numeric>
                    {duty.appointment === null ? (
                      <span className="text-ink-faint">keiner</span>
                    ) : (
                      date(duty.appointment)
                    )}
                  </Cell>
                  <Cell>
                    <DutyStateMark state={duty.state} until={duty.appointment} />
                  </Cell>
                  <Cell>
                    {duty.result === null ? (
                      <span className="text-ink-faint">{activityWords.noneYet}</span>
                    ) : (
                      <TwoLines
                        main={<ResultMark result={duty.result} />}
                        sub={duty.resultReason}
                      />
                    )}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
          {planning ? (
            <PlanForm key={shown.id} activity={shown} formId={formId} />
          ) : (
            <Panel title="Durchführung">
              <FactList
                facts={[
                  {
                    label: 'Durchführung',
                    value:
                      shown.performer === null
                        ? null
                        : shown.performer === 'contractor'
                          ? 'Fremde Durchführung'
                          : 'Eigene Durchführung',
                  },
                  { label: 'Verantwortlich', value: shown.responsible?.name ?? null },
                  { label: 'Ausführend', value: performerOf(shown).main },
                  {
                    label: 'Fällig am',
                    value: shown.dueOn === null ? null : date(shown.dueOn),
                  },
                  ...(shown.performedOn === null
                    ? []
                    : [{ label: 'Durchgeführt am', value: date(shown.performedOn) }]),
                  ...(shown.closingReason === null
                    ? []
                    : [{ label: 'Grund', value: shown.closingReason }]),
                ]}
              />
            </Panel>
          )}
          <Panel title="So geht es weiter">
            <ol className="m-0 list-decimal pl-[18px] text-[13px] leading-[1.5]">
              <li className="mb-[5px]">
                {shown.performer === 'contractor'
                  ? activityWords.stepContractor
                  : activityWords.stepDevice}
              </li>
              <li>
                {shown.performer === 'contractor'
                  ? activityWords.stepReport
                  : activityWords.stepSignature}
              </li>
            </ol>
          </Panel>
          <NoteBox>{activityWords.stays}</NoteBox>
        </div>
        <Panel title="Woher">
          <FactList
            keyWidth={110}
            facts={[
              { label: 'Angelegt', value: `am ${date(shown.createdAt.slice(0, 10))}` },
              { label: 'Ort', value: where.line },
              {
                label: 'Letzter Nachweis',
                value: lastMet === undefined ? 'keiner' : date(lastMet),
              },
              ...(qualifications.length === 0
                ? []
                : [{ label: 'Qualifikation', value: qualifications.join(', ') }]),
            ]}
          />
        </Panel>
      </div>
      {closing ? (
        <CloseActivityDialog
          key={shown.id}
          activity={shown}
          sub={where.name}
          onClose={() => {
            setClosing(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/**
 * "Nicht durchgeführt", the board "Prüfung mit Grund schließen" (#183, 4.4 of
 * the concept): an open or begun inspection or maintenance closed with the
 * reason, which each of its duties takes as its result. The appointment of
 * its duties stays as it is. Asked of the route, with a connection, and not
 * taken back: a new activity is made at the page of the duty.
 */
function CloseActivityDialog({
  activity,
  sub,
  onClose,
}: {
  readonly activity: ActivityDetails
  readonly sub: string
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save() {
    const values = { closingReason: reason.trim() }
    const wrong = activityProblems({ status: 'not_performed', ...values })['closingReason']

    setProblem(wrong)
    setTrouble(null)

    if (wrong !== undefined) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(
        client,
        'POST',
        `/activities/${activity.id}/close`,
        activity.id,
        values,
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The page and the list are read again, and the page of each duty.
      await queries.invalidateQueries({ queryKey: ['activities'] })
      await queries.invalidateQueries({ queryKey: ['duties'] })
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Nicht durchgeführt"
      width={520}
      onClose={onClose}
      sub={[activity.title, sub].filter(Boolean).join(', ')}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextArea
          label="Grund"
          rows={3}
          required
          starred
          maxLength={activityLimits.closingReason}
          value={reason}
          hint={activityWords.closingHint}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox>{activityWords.whatClosingDoes}</NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Ban} disabled={working}>
            {working ? 'Einen Moment' : 'Als nicht durchgeführt schließen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * The plan of an open activity, for whoever plans and hands out work: whether
 * the own people or a contractor perform it, who answers for it, who performs
 * it or which contractor, and the day it is due on. The people to choose from
 * see the area of the activity; the server hands them out and asks again.
 */
function PlanForm({
  activity,
  formId,
}: {
  readonly activity: ActivityDetails
  readonly formId: string
}) {
  const client = useSync()
  const queries = useQueryClient()
  const candidates = useQuery(candidatesQuery(activity.id))
  const [performer, setPerformer] = useState<DutyPerformer>(activity.performer ?? 'own_staff')
  const [responsible, setResponsible] = useState(activity.responsible?.userId ?? '')
  const [person, setPerson] = useState(activity.performerPerson?.userId ?? '')
  const [contractor, setContractor] = useState(activity.contractorNote ?? '')
  const [dueOn, setDueOn] = useState<string>(activity.dueOn ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)

  /** The people on offer, and the one named before where they are not among them, so that the choice shows who it is. */
  const options = (
    offered: readonly DutyPerson[] | undefined,
    named: DutyPerson | null,
    empty: string,
  ) => [
    { value: '', label: empty },
    ...(offered ?? []).map((each) => ({ value: each.userId, label: each.name })),
    ...(named !== null && !(offered ?? []).some((each) => each.userId === named.userId)
      ? [{ value: named.userId, label: named.name }]
      : []),
  ]

  async function save() {
    const values = {
      responsibleUserId: responsible === '' ? null : responsible,
      performer,
      performerUserId: performer === 'own_staff' && person !== '' ? person : null,
      contractorNote:
        performer === 'contractor' && contractor.trim() !== '' ? contractor.trim() : null,
      dueOn: dueOn === '' ? null : dueOn,
    }
    const found = activityPlanProblems(values)

    setProblems(found)
    setTrouble(null)
    setSaved(false)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(
        client,
        'PUT',
        `/activities/${activity.id}/plan`,
        activity.id,
        values,
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['activities'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  // The choice says what the card is about, as the title of the card does on
  // the board; a title above it would say it twice.
  return (
    <Panel>
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Choice<DutyPerformer>
          label="Durchführung"
          value={performer}
          onChange={setPerformer}
          disabled={working}
          options={[
            { value: 'own_staff', label: 'Eigene Durchführung', note: activityWords.ownNote },
            { value: 'contractor', label: 'Fremde Durchführung', note: activityWords.foreignNote },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Verantwortlich"
            value={responsible}
            onChange={setResponsible}
            options={options(
              candidates.data?.responsible,
              activity.responsible,
              activityWords.nobodyNamed,
            )}
            {...(problems['responsibleUserId'] ? { problem: problems['responsibleUserId'] } : {})}
          />
          {performer === 'own_staff' ? (
            <SelectField
              label="Ausführend"
              value={person}
              onChange={setPerson}
              options={options(
                candidates.data?.performers,
                activity.performerPerson,
                activityWords.nobody,
              )}
              {...(problems['performerUserId'] ? { problem: problems['performerUserId'] } : {})}
            />
          ) : (
            <Field
              label="Fremdfirma"
              value={contractor}
              maxLength={200}
              onChange={(event) => {
                setContractor(event.target.value)
              }}
              {...(problems['contractorNote'] ? { problem: problems['contractorNote'] } : {})}
            />
          )}
          <Field
            label="Fällig am"
            type="date"
            value={dueOn}
            onChange={(event) => {
              setDueOn(event.target.value)
            }}
            {...(problems['dueOn'] ? { problem: problems['dueOn'] } : {})}
          />
        </div>
        {candidates.isError ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {activityWords.peopleFailed}
          </p>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        {saved ? <Saved /> : null}
      </form>
    </Panel>
  )
}
