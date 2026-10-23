import {
  activityKindLabel,
  activityStatusLabel,
  byNameIn,
  defaultDueOn,
  type DefectCheckOutcome,
  defectCheckProblems,
  type DefectClassChoice,
  type DefectEntry,
  defectLimits,
  defectOriginWord,
  defectProblems,
  type DefectReading,
  type DefectRegister,
  type DefectRegisterFilter,
  defectRegisterPage,
  defectRegisterStateLabel,
  defectRegisterStates,
  defectReportWords,
  type DefectStatus,
  defectStatuses,
  defectStatusLabel,
  defectWhere,
  entryShutsDown,
  type RecordState,
  withoutClass,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Choice,
  Column,
  Field,
  Panel,
  SelectField,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, moment, today } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Chip,
  Empty,
  FactList,
  NoteBox,
  PageHead,
  Screen,
  useTableExport,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  text,
  useRecord,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  Check,
  ClipboardList,
  type LucideIcon,
  Pencil,
  Plus,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type ReactNode, useId, useMemo, useRef, useState } from 'react'

import { fileDocument } from '../../app/documents.js'
import { circuitTitle, structurePlaces } from '../../app/structure-places.js'
import { titleOfRoom } from '../../app/place-records.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { useAreas, useHeldArea } from '../../session/areas.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { activityPlaces } from '../activity-addresses.js'
import {
  defectFilterOf,
  type DefectListAddress,
  defectListPlace,
  defectPlaces,
  defectRegisterRequest,
  defectReportRequest,
  defectSearch,
  defectStartOf,
  defectStartSearch,
} from '../defect-addresses.js'
import { DocumentsCard } from '../documents.js'
import { usePdf } from '../pdf-button.js'
import { evidencePlaces } from '../duty-addresses.js'
import { faultPlaces } from '../fault-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { NarrowedToBuilding } from '../narrowed-to-building.js'
import { RegisterFilter } from '../register-filter.js'
import { asTableAddress } from '../table-address.js'
import { workOrderPlaces, workOrderStartSearch } from '../work-order-addresses.js'

export const defectWords = {
  // A defect whose content went after the end of its retention (#412), the board
  // "Mangel nach Ablauf der Aufbewahrung, ohne Inhalt (2.6, #412)".
  emptied: (at: string) =>
    `Inhalt gelöscht am ${moment(at)} nach Ablauf der Aufbewahrung, fünf Jahre nach der Beseitigung. Beschreibung, Bemerkung der Nachprüfung und Fotos sind gelöscht. Die Zeile bleibt mit Ort, Tagen, Klasse und Stand; geändert wird sie nicht mehr.`,
  sub: 'Was festgestellt wurde, an einer Anlage oder einem Ort, bis es nachgeprüft ist.',
  note: 'Offen ist ein Mangel, bis er nachgeprüft ist. „Behoben“ kommt aus dem Auftrag, „Nachgeprüft“ ist ein eigener Schritt.',
  noConnection: 'Die Mängel kommen vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Mängel werden geladen.',
  failed: 'Die Mängel ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  nothingPasses: 'Kein Mangel passt zu dem, wonach die Liste eingegrenzt ist.',
  none: 'Gerade ist kein Mangel offen.',
  withoutClass: 'ohne Klasse',
  noDay: 'keine',
  noOrder: 'keiner',
  late: 'über der Frist',
  notThere: 'Diesen Mangel gibt es nicht, oder er liegt außerhalb dessen, was dieser Zugang sieht.',
  pageNoConnection: 'Ein Mangel kommt vom Server. Gerade ist keine Verbindung da.',
  pageLoading: 'Der Mangel wird geladen.',
  pageFailed: 'Der Mangel ließ sich nicht laden. Er kommt vom Server, mit Verbindung.',
  orderNote:
    'Behoben ist der Mangel, seit der Auftrag unterschrieben ist. Wird der Auftrag zurückgewiesen, ist er wieder beauftragt.',
  checkNote:
    'Nachprüfen heißt: jemand sieht vor Ort nach, ob der Mangel wirklich behoben ist. Erst dann ist er erledigt.',
  checkNotRemedied:
    '„Nicht behoben“ setzt den Mangel zurück auf „Festgestellt“. Er braucht dann einen neuen Auftrag.',
  reportedBy:
    'Melden darf jede Rolle, auch vor Ort ohne Netz. Klasse und Frist vergibt, wer Mängel führt; bis dahin steht der Mangel als „ohne Klasse“ in der Liste.',
  reportWithout: 'Klasse und Frist vergibt, wer Mängel führt.',
  outOfService:
    'Bekommt ein Mangel an einer Anlage eine Klasse, die sie unsicher macht, ist die Anlage außer Betrieb, bis er behoben ist; Akte, Raum und Lagebild zeigen es.',
  photosAfter: 'Die Fotos gehen mit dem nächsten Abgleich an den Server, auch ohne Netz.',
  classesFailed: 'Die Klassen ließen sich nicht laden. Das braucht eine Verbindung.',
  noPlace: 'Sagen Sie, woran der Mangel ist.',
  sectionNone: 'Hier ist kein Mangel offen.',
} as const

/** The way a status is drawn, `status()` of the boards: in words, in a tone and with a symbol of its own. */
const statusLooks: Readonly<Record<DefectStatus, { tone: StatusTone; icon: LucideIcon }>> = {
  found: { tone: 'conflict', icon: TriangleAlert },
  ordered: { tone: 'waiting', icon: ClipboardList },
  remedied: { tone: 'done', icon: Check },
  verified: { tone: 'done', icon: ShieldCheck },
}

export function DefectStatusMark({ status }: { readonly status: DefectStatus }) {
  const look = statusLooks[status]

  return (
    <Status tone={look.tone} icon={look.icon}>
      {defectStatusLabel[status]}
    </Status>
  )
}

/** The page of one defect, the summary for the navigation and the classes of a defect by hand. */
export function defectQuery(id: string) {
  return {
    queryKey: ['defects', 'page', id],
    queryFn: () => request<DefectReading>(`/defects/${id}`),
  } as const
}

const handClassesQuery = {
  queryKey: ['defects', 'classes'],
  queryFn: () => request<readonly DefectClassChoice[]>('/defects/classes'),
} as const

/** A class by its word: from the catalogue of the device, the key where it has none, and "ohne Klasse" for none. */
export function useClassWord(): (key: string | null) => string {
  const catalogue = useCatalogue()

  return (key) =>
    key === null
      ? defectWords.withoutClass
      : (catalogue?.defectClass(key)?.defectClass.label ?? key)
}

/**
 * Where a defect is, as two lines and a link: the asset, the room, the
 * building or the property, and below it where that is, in the words of its
 * table (#236).
 */
function whereOf(defect: DefectEntry): { name: string; to: string; sub: string } {
  const { place } = defect
  const { name, sub } = defectWhere(place)
  const to =
    place.asset !== null
      ? officePlaces.asset(place.asset.id)
      : place.roomId !== null
        ? officePlaces.room(place.roomId)
        : place.buildingId !== null
          ? officePlaces.building(place.buildingId)
          : officePlaces.property(place.propertyId)

  return { name, to, sub }
}

/** Where a defect comes from, in a word, as its table says it (#236). */
const originWord = defectOriginWord

function DueCell({ defect }: { readonly defect: DefectEntry }) {
  if (defect.dueOn === null) {
    return <span className="text-ink-faint">{defectWords.noDay}</span>
  }

  return defect.overdue ? (
    <div className="leading-[1.32]">
      <div className="font-semibold text-conflict">{date(defect.dueOn)}</div>
      <div className="text-[12px] text-conflict">{defectWords.late}</div>
    </div>
  ) : (
    <span>{date(defect.dueOn)}</span>
  )
}

/** Two lines in a cell, `lines()` of the boards: the thing, and below it in small print where it is. */
function TwoLines({ main, sub }: { readonly main: ReactNode; readonly sub: ReactNode }) {
  return (
    <div className="leading-[1.32]">
      <div className="font-medium">{main}</div>
      {sub === null || sub === '' ? null : <div className="text-[12px] text-ink-faint">{sub}</div>}
    </div>
  )
}

/** The work order of a defect in a cell, by its number, or "keiner". */
function OrderCell({ defect }: { readonly defect: DefectEntry }) {
  if (defect.workOrder === null) {
    return <span className="text-ink-faint">{defectWords.noOrder}</span>
  }

  return (
    <Link to={workOrderPlaces.order(defect.workOrder.activityId)} className={factLink}>
      {defect.workOrder.number ?? defect.workOrder.title}
    </Link>
  )
}

/** A page of the register at a time, narrowed by a filter. */
function useRegister(filter: DefectRegisterFilter) {
  return useInfiniteQuery({
    queryKey: ['defects', 'register', filter],
    queryFn: ({ pageParam }) => request<DefectRegister>(defectRegisterRequest(filter, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.more ? all.reduce((sum, page) => sum + page.defects.length, 0) : undefined,
    placeholderData: keepPreviousData,
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
}

/** "4 offen, 2 über ihrer Frist": how many the list holds. */
function countOf(register: DefectRegister): string {
  const open = `${register.counts.open.toLocaleString('de-DE')} offen`

  return register.counts.overdue === 0
    ? open
    : `${open}, ${register.counts.overdue.toLocaleString('de-DE')} über ihrer Frist`
}

/** The rows of defects, as the list and the sections at an asset and a room show them. */
function DefectTable({
  defects,
  caption,
  note,
  footer,
  withPlace = true,
}: {
  readonly defects: readonly DefectEntry[]
  readonly caption: string
  readonly note?: string
  readonly footer?: ReactNode
  readonly withPlace?: boolean
}) {
  const classWord = useClassWord()
  const catalogue = useCatalogue()
  /** Whether a defect puts its asset out of service (#345), which its class says under its word. */
  const shutsDown = (defect: DefectEntry) => catalogue !== null && entryShutsDown(defect, catalogue)

  return (
    <TablePanel
      caption={caption}
      {...(note === undefined ? {} : { note })}
      {...(footer === undefined ? {} : { footer })}
      cards={defects.map((defect) => ({
        key: defect.id,
        title: (
          <Link to={defectPlaces.defect(defect.id)} className={cardLink}>
            {defect.description}
          </Link>
        ),
        sub: [
          withPlace ? whereOf(defect).name : null,
          classWord(defect.defectClass),
          shutsDown(defect) ? defectReportWords.unsafe : null,
          defect.dueOn === null ? null : `bis ${date(defect.dueOn)}`,
          defect.overdue ? defectWords.late : null,
        ]
          .filter((part) => part !== null && part !== '')
          .join(' · '),
        right: <DefectStatusMark status={defect.status} />,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[180px]">Mangel</Column>
          {withPlace ? <Column className="w-[260px] min-w-[170px]">Anlage oder Ort</Column> : null}
          <Column className="w-[100px] min-w-[90px]">Klasse</Column>
          <Column className="w-[110px] min-w-[100px]">Frist</Column>
          <Column className="w-[130px] min-w-[120px]">Stand</Column>
          <Column className="w-[150px] min-w-[120px]">Herkunft</Column>
          <Column className="w-[110px] min-w-[96px]">Auftrag</Column>
        </tr>
      </thead>
      <tbody>
        {defects.map((defect) => {
          const where = whereOf(defect)

          return (
            <tr key={defect.id}>
              <Cell>
                <Link to={defectPlaces.defect(defect.id)} className={factLink}>
                  {defect.description}
                </Link>
              </Cell>
              {withPlace ? (
                <Cell>
                  <TwoLines main={<Link to={where.to}>{where.name}</Link>} sub={where.sub} />
                </Cell>
              ) : null}
              <Cell>
                {defect.defectClass === null ? (
                  <span className="text-ink-faint">{defectWords.withoutClass}</span>
                ) : (
                  classWord(defect.defectClass)
                )}
                {shutsDown(defect) ? (
                  <div className="text-[12px] leading-[1.35] text-conflict">
                    {defectReportWords.unsafe}
                  </div>
                ) : null}
              </Cell>
              <Cell>
                <DueCell defect={defect} />
              </Cell>
              <Cell>
                <DefectStatusMark status={defect.status} />
              </Cell>
              <Cell>
                <span className="text-ink-muted">{`${originWord(defect.origin)}, ${date(defect.foundOn)}`}</span>
              </Cell>
              <Cell>
                <OrderCell defect={defect} />
              </Cell>
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Mängel" in the office, `maengel()` of the boards (4.6 of the concept,
 * #116): the defects in the areas of the person, what waits to be set right
 * first, with the class, the deadline, how far each is, where it comes from
 * and the work order that sets it right.
 *
 * The list comes from the server a page at a time and is narrowed there; it
 * needs a connection and says so without one. What it is narrowed by stands
 * in the address.
 */
export function DefectListScreen() {
  const address = useSearch({ strict: false })
  const filter = useMemo(() => defectFilterOf(address), [address])
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const areas = useAreas()
  const catalogue = useCatalogue()
  const reports = useRight('defect.report')
  const state = filter.state ?? 'open'
  const pages = useRegister(filter)
  // What the register shows under its filter, whole and not a page, as a table (#236).
  const table = useTableExport(asTableAddress(defectRegisterRequest(filter, 0)))
  // The same as the report of the defects, a PDF of the moment it is asked for (#345).
  const report = usePdf(
    defectReportRequest(filter),
    `${defectReportWords.title} ${today()}`,
    defectReportWords.title,
  )
  const first = pages.data?.pages[0]
  const defects = pages.data?.pages.flatMap((page) => page.defects) ?? []
  const narrowed = Object.keys(filter).some((name) => name !== 'state')

  /** The filter with one part set, or without it for the choice "all". */
  const set = (name: keyof DefectListAddress, value: string) => {
    const { [name]: _, ...rest } = filter

    void navigate({
      to: defectListPlace.to,
      search: defectSearch(value === '' ? rest : { ...rest, [name]: value }),
      replace: true,
    })
  }
  const named = (records: readonly RecordState[]) =>
    records
      .map((record) => ({ value: String(record['id']), label: maybeText(record, 'name') ?? '' }))
      .sort((left, right) => byNameIn(left.label, right.label))
  const classes =
    catalogue === null
      ? []
      : catalogue.packages.flatMap((pack) => catalogue.defectClasses(pack.name))

  return (
    <Screen>
      <PageHead
        title="Mängel"
        sub={defectWords.sub}
        {...(first === undefined ? {} : { count: countOf(first) })}
        actions={
          <>
            {table.button}
            {report.button}
            {reports ? (
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  void navigate({ to: defectPlaces.report })
                }}
              >
                Mangel melden
              </Button>
            ) : null}
          </>
        }
      />
      {table.trouble}
      {report.trouble}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div role="group" aria-label="Liste" className="flex flex-wrap gap-1.5">
          {defectRegisterStates.map((each) => (
            <Chip
              key={each}
              pressed={state === each}
              onPress={() => {
                set('state', each === 'open' ? '' : each)
              }}
            >
              {each === 'all' || first === undefined
                ? defectRegisterStateLabel[each]
                : `${defectRegisterStateLabel[each]} ${first.counts[each].toLocaleString('de-DE')}`}
            </Chip>
          ))}
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5 max-lg:w-full">
          <RegisterFilter
            label="Liegenschaft"
            className="lg:w-[200px]"
            value={filter.propertyId ?? ''}
            onChange={(value) => {
              set('propertyId', value)
            }}
          >
            <option value="">Alle Liegenschaften</option>
            {named(properties).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </RegisterFilter>
          {areas.length > 1 ? (
            <RegisterFilter
              label="Bereich"
              className="lg:w-[150px]"
              value={filter.areaId ?? ''}
              onChange={(value) => {
                set('areaId', value)
              }}
            >
              <option value="">Alle Bereiche</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </RegisterFilter>
          ) : null}
          <RegisterFilter
            label="Klasse"
            className="lg:w-[150px]"
            value={filter.defectClass ?? ''}
            onChange={(value) => {
              set('defectClass', value)
            }}
          >
            <option value="">Alle Klassen</option>
            <option value={withoutClass}>Ohne Klasse</option>
            {classes.map(({ defectClass }) => (
              <option key={defectClass.key} value={defectClass.key}>
                {defectClass.label}
              </option>
            ))}
          </RegisterFilter>
        </div>
      </div>
      {filter.buildingId === undefined ? null : (
        <NarrowedToBuilding
          buildingId={filter.buildingId}
          onLift={() => {
            set('buildingId', '')
          }}
        />
      )}
      {first === undefined ? (
        <Panel>
          <Empty>
            {pages.isError
              ? defectWords.failed
              : pages.fetchStatus === 'paused'
                ? defectWords.noConnection
                : defectWords.loading}
          </Empty>
        </Panel>
      ) : defects.length === 0 ? (
        <Panel>
          <Empty>
            {narrowed || state !== 'open' ? defectWords.nothingPasses : defectWords.none}
          </Empty>
        </Panel>
      ) : (
        <DefectTable
          defects={defects}
          caption="Mängel mit Anlage oder Ort, Klasse, Frist, Stand, Herkunft und Auftrag"
          note={defectWords.note}
          footer={
            <>
              <span>
                {`${defects.length.toLocaleString('de-DE')} von ${first.total.toLocaleString('de-DE')}`}
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
        />
      )}
    </Screen>
  )
}

/** The open defects at an asset or in a room, one page as large as a page may be. */
function useOpenDefectsAt(at: Pick<DefectRegisterFilter, 'assetId' | 'roomId'>, reads: boolean) {
  const filter: DefectRegisterFilter = { state: 'open', ...at }

  return useQuery({
    queryKey: ['defects', 'at', filter],
    queryFn: () =>
      request<DefectRegister>(defectRegisterRequest(filter, 0, defectRegisterPage.most)),
    enabled: reads,
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
}

/** What a card says while its defects are not there: failed, no connection, or none. */
function unreadWords(query: ReturnType<typeof useOpenDefectsAt>): string {
  return query.isError
    ? defectWords.failed
    : query.data === undefined && query.fetchStatus === 'paused'
      ? defectWords.noConnection
      : query.data === undefined
        ? defectWords.loading
        : defectWords.sectionNone
}

/**
 * The card "Mängel" in the main column of the file of an asset, as the board
 * draws it (#87, #116): its open defects with class, deadline and status, and
 * the button that reports one at it.
 */
export function AssetDefectsCard({ assetId }: { readonly assetId: string }) {
  const reads = useRight('defect.read')
  const reports = useRight('defect.report')
  const navigate = useNavigate()
  const classWord = useClassWord()
  const open = useOpenDefectsAt({ assetId }, reads)
  const defects = open.data?.defects ?? []

  if (!reads) {
    return null
  }

  const action = reports ? (
    <Button
      size="small"
      icon={Plus}
      onClick={() => {
        void navigate({ to: defectPlaces.report, search: defectStartSearch({ assetId }) })
      }}
    >
      Mangel melden
    </Button>
  ) : null

  if (defects.length === 0) {
    return (
      <Panel title="Mängel" action={action}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">{unreadWords(open)}</p>
      </Panel>
    )
  }

  return (
    <TablePanel
      title="Mängel"
      action={action}
      caption="Offene Mängel der Anlage mit Klasse, Frist und Stand"
      grow={false}
      cards={defects.map((defect) => ({
        key: defect.id,
        title: (
          <Link to={defectPlaces.defect(defect.id)} className={cardLink}>
            {defect.description}
          </Link>
        ),
        sub: [
          classWord(defect.defectClass),
          defect.dueOn === null ? null : `bis ${date(defect.dueOn)}`,
          defect.overdue ? defectWords.late : null,
        ]
          .filter((part) => part !== null)
          .join(' · '),
        right: <DefectStatusMark status={defect.status} />,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[160px]">Mangel</Column>
          <Column className="w-[96px] min-w-[90px]">Klasse</Column>
          <Column numeric className="w-[96px] min-w-[90px]">
            Frist
          </Column>
          <Column className="w-[130px] min-w-[120px]">Stand</Column>
        </tr>
      </thead>
      <tbody>
        {defects.map((defect) => (
          <tr key={defect.id}>
            <Cell>
              <Link to={defectPlaces.defect(defect.id)} className={factLink}>
                {defect.description}
              </Link>
            </Cell>
            <Cell>
              {defect.defectClass === null ? (
                <span className="text-ink-faint">{defectWords.withoutClass}</span>
              ) : (
                classWord(defect.defectClass)
              )}
            </Cell>
            <Cell numeric>
              <DueCell defect={defect} />
            </Cell>
            <Cell>
              <DefectStatusMark status={defect.status} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * The card "Offene Mängel" beside the assets of a room, as the board draws it
 * (#116): the open defects at the room and at the assets that stand in it,
 * each with where it is, its deadline and where it comes from.
 */
export function RoomDefectsCard({ roomId }: { readonly roomId: string }) {
  const reads = useRight('defect.read')
  const open = useOpenDefectsAt({ roomId }, reads)
  const defects = open.data?.defects ?? []

  if (!reads) {
    return null
  }

  return (
    <Panel title="Offene Mängel">
      {defects.length === 0 ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">{unreadWords(open)}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {defects.map((defect) => (
            <li key={defect.id} className="flex items-start gap-2.5">
              <div className="min-w-0 grow leading-[1.3]">
                <Link to={defectPlaces.defect(defect.id)} className={factLink}>
                  {defect.description}
                </Link>
                <div className="text-[12px] text-ink-faint">
                  {[
                    defect.place.asset?.number ?? defect.place.asset?.name ?? null,
                    defect.dueOn === null ? null : `Frist ${date(defect.dueOn)}`,
                    `${originWord(defect.origin)} vom ${date(defect.foundOn)}`,
                  ]
                    .filter((part) => part !== null)
                    .join(', ')}
                </div>
              </div>
              <DefectStatusMark status={defect.status} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** The index of a status on the way from found to checked again. */
const stepOf: Readonly<Record<DefectStatus, number>> = {
  found: 0,
  ordered: 1,
  remedied: 2,
  verified: 3,
}

/** The four statuses of a defect in a row, `stepper()` of the boards: the ones reached with their day, the next one marked. */
function DefectSteps({ defect }: { readonly defect: DefectReading }) {
  const current = stepOf[defect.status]
  const order = defect.workOrder
  const subs: Readonly<Record<DefectStatus, string>> = {
    found: `${date(defect.foundOn)}, ${originWord(defect.origin)}`,
    ordered: order === null ? 'mit einem Auftrag' : (order.number ?? order.title),
    remedied:
      order?.performedOn === null || order === null
        ? 'aus dem Auftrag'
        : `${date(order.performedOn)}, aus dem Auftrag`,
    verified:
      defect.status === 'verified' && defect.checkedOn !== null
        ? date(defect.checkedOn)
        : 'ein eigener Schritt',
  }

  return (
    <ol aria-label="Stand des Mangels" className="flex gap-2 max-sm:flex-col">
      {defectStatuses.map((status, index) => {
        const reached = index <= current
        const next = index === current + 1

        return (
          <li
            key={status}
            className="flex min-w-0 flex-1 flex-col gap-1.5 max-sm:flex-row max-sm:items-start max-sm:gap-2.5"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
                  reached
                    ? 'border-done bg-done text-white'
                    : next
                      ? 'border-ink bg-surface'
                      : 'border-control bg-surface'
                }`}
              >
                {reached ? <Check size={13} strokeWidth={3} /> : null}
              </span>
              <span
                aria-hidden="true"
                className={`h-[2px] grow max-sm:hidden ${index < current ? 'bg-done' : 'bg-line'}`}
              />
            </div>
            <div>
              <div
                className={`text-[13px] font-semibold ${
                  reached ? 'text-done' : next ? 'text-ink' : 'text-ink-faint'
                }`}
              >
                {defectStatusLabel[status]}
                <span className="sr-only">{reached ? ', erreicht' : ', noch nicht'}</span>
              </div>
              <div className="text-[12px] leading-[1.35] text-ink-faint">{subs[status]}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Where a defect comes from, as the fact "Herkunft" says it, with a link where there is a page. */
function OriginFact({ defect }: { readonly defect: DefectReading }) {
  const { origin } = defect
  const day = date(defect.foundOn)

  switch (origin.kind) {
    case 'activity':
      return origin.activityKind === 'inspection' || origin.activityKind === 'maintenance' ? (
        <span>
          <Link to={activityPlaces.activity(origin.activityId)} className={factLink}>
            {origin.title}
          </Link>
          {`, ${day}`}
        </span>
      ) : (
        <span>{`${activityKindLabel[origin.activityKind]} ${origin.title}, ${day}`}</span>
      )
    case 'report':
      return (
        <span>
          <Link to={evidencePlaces.evidence(origin.evidenceId)} className={factLink}>
            Bericht einer Fremdfirma
          </Link>
          {`, ${day}`}
        </span>
      )
    case 'fault':
      return (
        <span>
          <Link to={faultPlaces.report(origin.faultReportId)} className={factLink}>
            Störmeldung
          </Link>
          {`, eingegangen am ${date(origin.receivedAt)}, festgestellt am ${day}`}
        </span>
      )
    case 'hand':
      return <span>{`von Hand, ${day}`}</span>
  }
}

/**
 * The page of a defect, `mangel()` of the boards (4.6 of the concept, #116):
 * how far it is, what was found and where, its class and deadline, the work
 * order that sets it right, and for whoever keeps defects the way to change
 * class and deadline and to check it again once it is remedied. Nobody is
 * named: who reported, classed or checked it stands in its stamp and in the
 * change log (section 9 of the concept).
 */
/**
 * The circuit a defect was found on (#350), as the office holds it: the
 * defect names it once the signature wrote it, and it stands while neither it
 * nor its board is marked. Its page in the office, its name and its board.
 */
function useCircuitOfDefect(defectId: string | undefined) {
  const defect = useRecord('defects', defectId)
  const circuit = useRecord('circuits', maybeText(defect, 'circuitId') ?? undefined)
  const board = useRecord(
    'distribution_boards',
    maybeText(circuit, 'distributionBoardId') ?? undefined,
  )
  const assetId = maybeText(board, 'assetId')

  if (
    circuit === null ||
    board === null ||
    assetId === null ||
    maybeText(circuit, 'deletedAt') !== null ||
    maybeText(board, 'deletedAt') !== null
  ) {
    return null
  }

  return {
    to: structurePlaces.circuit(assetId, String(board['id']), String(circuit['id'])),
    name: circuitTitle(circuit),
    board: text(board, 'designation'),
  }
}

export function DefectScreen() {
  const { defectId } = useParams({ strict: false }) as { defectId?: string }
  const page = useQuery({ ...defectQuery(defectId ?? ''), enabled: defectId !== undefined })
  const circuit = useCircuitOfDefect(defectId)
  const keeps = useRight('defect.write')
  const plans = useRight('activity.write')
  const navigate = useNavigate()
  const classWord = useClassWord()
  const [editing, setEditing] = useState(false)
  const shown = page.data

  if (shown === undefined || defectId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Mangel'}
          crumbs={[defectListPlace]}
          phoneBack={defectListPlace}
        />
        <Empty>
          {gone
            ? defectWords.notThere
            : page.isError
              ? defectWords.pageFailed
              : page.fetchStatus === 'paused'
                ? defectWords.pageNoConnection
                : defectWords.pageLoading}
        </Empty>
      </Screen>
    )
  }

  const where = whereOf(shown)
  // Once its content went (#412), nothing is offered any more.
  const emptied = shown.emptiedAt !== null
  const changes = keeps && shown.status !== 'verified' && !emptied
  const choice = shown.classChoices.find((each) => each.key === shown.defectClass)
  const order = shown.workOrder

  return (
    <Screen>
      <PageHead
        title={shown.description}
        crumbs={[defectListPlace]}
        phoneBack={defectListPlace}
        badges={
          <>
            <DefectStatusMark status={shown.status} />
            <Status tone="neutral">{classWord(shown.defectClass)}</Status>
          </>
        }
        actions={
          <>
            <ChangesButton table="defects" id={shown.id} />
            {/* A found defect gets its work order here (#117). */}
            {plans && shown.status === 'found' && !emptied ? (
              <Button
                icon={Plus}
                onClick={() => {
                  void navigate({
                    to: workOrderPlaces.new,
                    search: workOrderStartSearch({ defectId: shown.id }),
                  })
                }}
              >
                Auftrag anlegen
              </Button>
            ) : null}
            {changes && !editing ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  setEditing(true)
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
          </>
        }
      />
      {shown.emptiedAt === null ? null : <NoteBox>{defectWords.emptied(shown.emptiedAt)}</NoteBox>}
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Stand">
            <DefectSteps defect={shown} />
          </Panel>
          {editing ? (
            <KeepForm
              key={shown.id}
              defect={shown}
              onDone={() => {
                setEditing(false)
              }}
            />
          ) : (
            <Panel title="Mangel">
              <div className="flex flex-col gap-3">
                <p className="text-[14px] leading-[1.45] [overflow-wrap:anywhere]">
                  {shown.description}
                </p>
                <FactList
                  keyWidth={110}
                  facts={[
                    { label: 'Herkunft', value: <OriginFact defect={shown} /> },
                    {
                      label: 'Ort',
                      value: (
                        <span>
                          <Link to={where.to} className={factLink}>
                            {where.name}
                          </Link>
                          {where.sub === '' ? null : `, ${where.sub}`}
                        </span>
                      ),
                    },
                    // The circuit it was found on, beside the asset (#350).
                    ...(circuit === null
                      ? []
                      : [
                          {
                            label: 'Stromkreis',
                            value: (
                              <span>
                                <Link to={circuit.to} className={factLink}>
                                  {circuit.name}
                                </Link>
                                {`, ${circuit.board}`}
                              </span>
                            ),
                          },
                        ]),
                    { label: 'Klasse', value: classWord(shown.defectClass) },
                    {
                      label: 'Frist',
                      value:
                        shown.dueOn === null
                          ? defectWords.noDay
                          : [
                              date(shown.dueOn),
                              choice?.dueDays === null || choice === undefined
                                ? null
                                : `Vorgabe der Klasse: ${String(choice.dueDays)} Tage`,
                              shown.overdue ? defectWords.late : null,
                            ]
                              .filter(Boolean)
                              .join(', '),
                    },
                    ...(shown.checkedOn === null
                      ? []
                      : [
                          {
                            label: 'Nachprüfung',
                            value: [
                              `${date(shown.checkedOn)}, ${
                                shown.status === 'verified' ? 'nachgeprüft' : 'nicht behoben'
                              }`,
                              shown.checkNote,
                            ]
                              .filter(Boolean)
                              .join(': '),
                          },
                        ]),
                  ]}
                />
              </div>
            </Panel>
          )}
          {emptied ? null : (
            <DocumentsCard
              title="Fotos"
              place={{ propertyId: shown.place.propertyId, defectId: shown.id }}
              at={`Mangel „${shown.description}“`}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {order === null ? null : (
            <Panel title="Auftrag daraus">
              <div className="flex flex-col gap-2">
                <div className="leading-[1.32]">
                  <div className="font-medium">
                    <Link to={workOrderPlaces.order(order.activityId)} className={factLink}>
                      {[order.number, order.title].filter(Boolean).join(' ')}
                    </Link>
                  </div>
                  <div className="text-[12px] text-ink-faint">
                    {[
                      activityStatusLabel[order.status],
                      order.performedOn === null ? null : `am ${date(order.performedOn)}`,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </div>
                </div>
                <p className="text-[12px] leading-[1.4] text-ink-muted">{defectWords.orderNote}</p>
              </div>
            </Panel>
          )}
          {keeps && shown.status === 'remedied' && !emptied ? (
            <CheckForm key={shown.id} defect={shown} />
          ) : null}
        </div>
      </div>
    </Screen>
  )
}

/**
 * What whoever keeps defects says of one (section 7: "führen"): its
 * description, its class, and the day it is to be set right by. Choosing a
 * class proposes the day its default gives; the day can be changed after.
 */
function KeepForm({
  defect,
  onDone,
}: {
  readonly defect: DefectReading
  readonly onDone: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [description, setDescription] = useState(defect.description)
  const [defectClass, setDefectClass] = useState(defect.defectClass ?? '')
  const [dueOn, setDueOn] = useState(defect.dueOn ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const choice = defect.classChoices.find((each) => each.key === defectClass)

  async function save() {
    const values = {
      description: description.trim(),
      defectClass: defectClass === '' ? null : defectClass,
      dueOn: dueOn === '' ? null : dueOn,
    }
    const found = defectProblems({ ...values, foundOn: defect.foundOn })

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'PATCH', `/defects/${defect.id}`, defect.id, values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['defects'] })
      await queries.invalidateQueries({ queryKey: ['assets'] })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title="Mangel">
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextArea
          label="Beschreibung"
          rows={3}
          required
          starred
          maxLength={defectLimits.description}
          value={description}
          problem={problems['description']}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Klasse"
            value={defectClass}
            hint="Bestimmt die Vorgabe der Frist."
            options={[
              { value: '', label: 'Ohne Klasse' },
              ...defect.classChoices.map((each) => ({ value: each.key, label: each.label })),
            ]}
            onChange={(value) => {
              setDefectClass(value)
              const proposed = defaultDueOn(
                defect.foundOn,
                defect.classChoices.find((each) => each.key === value)?.dueDays ?? null,
              )

              if (proposed !== null) {
                setDueOn(proposed)
              }
            }}
            {...(problems['defectClass'] ? { problem: problems['defectClass'] } : {})}
          />
          <Field
            label="Frist zur Beseitigung"
            type="date"
            value={dueOn}
            {...(choice?.dueDays === null || choice === undefined
              ? {}
              : { hint: `Vorgabe der Klasse: ${String(choice.dueDays)} Tage.` })}
            onChange={(event) => {
              setDueOn(event.target.value)
            }}
            {...(problems['dueOn'] ? { problem: problems['dueOn'] } : {})}
          />
        </div>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={working}
            onClick={() => {
              onDone()
            }}
          >
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            Speichern
          </Button>
        </div>
      </form>
    </Panel>
  )
}

/**
 * Checking a remedied defect again, the card "Nachprüfen" of the board: what
 * was found, and whether it is set right. Only for whoever keeps defects, and
 * only once it is remedied.
 */
function CheckForm({ defect }: { readonly defect: DefectReading }) {
  const client = useSync()
  const queries = useQueryClient()
  const [note, setNote] = useState('')
  const [checkedOn, setCheckedOn] = useState(today())
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function check(outcome: DefectCheckOutcome) {
    const values = { outcome, checkedOn, note: note.trim() === '' ? null : note.trim() }
    const found = defectCheckProblems(values, defect.foundOn, today())

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/defects/${defect.id}/check`, defect.id, values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['defects'] })
      await queries.invalidateQueries({ queryKey: ['assets'] })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title="Nachprüfen">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-[1.45] text-ink-muted">{defectWords.checkNote}</p>
        <Field
          label="Nachgeprüft am"
          type="date"
          value={checkedOn}
          onChange={(event) => {
            setCheckedOn(event.target.value)
          }}
          {...(problems['checkedOn'] ? { problem: problems['checkedOn'] } : {})}
        />
        <TextArea
          label="Bemerkung zur Nachprüfung"
          rows={2}
          maxLength={defectLimits.checkNote}
          value={note}
          placeholder="Was Sie vorgefunden haben"
          problem={problems['note']}
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
        <p className="text-[12px] leading-[1.4] text-ink-faint">{defectWords.checkNotRemedied}</p>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            icon={X}
            disabled={working}
            onClick={() => {
              void check('not_remedied')
            }}
          >
            Nicht behoben
          </Button>
          <Button
            tone="primary"
            icon={ShieldCheck}
            disabled={working}
            onClick={() => {
              void check('verified')
            }}
          >
            Nachgeprüft
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/** What a defect hangs on, as the form asks it. */
type Home = 'assetId' | 'roomId' | 'buildingId' | 'propertyId'

const homeLabel: Readonly<Record<Home, string>> = {
  assetId: 'Anlage',
  roomId: 'Raum',
  buildingId: 'Gebäude',
  propertyId: 'Liegenschaft',
}

/**
 * "Mangel melden" in the office, `mangel_neu()` of the boards (4.6 of the
 * concept, #116): where it is, what was found, photos and the day; class and
 * deadline for whoever keeps defects. It goes to the server with a connection,
 * the photos after it through the outbox. An asset, a room, a building or a
 * property that leads here hands over its place.
 */
export function NewDefectScreen() {
  const address = useSearch({ strict: false })
  const start = useMemo(() => defectStartOf(address), [address])
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const keeps = useRight('defect.write')
  const classes = useQuery({ ...handClassesQuery, enabled: keeps })
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')
  const held = useHeldArea()
  const picker = useRef<HTMLInputElement>(null)
  const formId = useId()
  const startHome = (Object.keys(homeLabel) as Home[]).find((home) => start[home] !== undefined)
  const [home, setHome] = useState<Home>(startHome ?? 'assetId')
  const [target, setTarget] = useState(startHome === undefined ? '' : (start[startHome] ?? ''))
  const [description, setDescription] = useState('')
  const [foundOn, setFoundOn] = useState(today())
  const [defectClass, setDefectClass] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [photos, setPhotos] = useState<readonly File[]>([])
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const choice = classes.data?.find((each) => each.key === defectClass)

  const recordsOf: Readonly<Record<Home, readonly RecordState[]>> = {
    assetId: assets,
    roomId: rooms,
    buildingId: buildings,
    // The property itself only for whoever holds its area (#310).
    propertyId: properties.filter((each) => held(each['areaId'])),
  }
  const propertyName = (id: unknown) =>
    maybeText(properties.find((property) => property['id'] === id) ?? null, 'name') ?? ''
  const labelOf = (record: RecordState): string => {
    switch (home) {
      case 'assetId':
        return [maybeText(record, 'number'), maybeText(record, 'name')].filter(Boolean).join(' ')
      case 'roomId':
        return `${titleOfRoom(record)}, ${propertyName(record['propertyId'])}`
      case 'buildingId':
        return `${maybeText(record, 'name') ?? ''}, ${propertyName(record['propertyId'])}`
      case 'propertyId':
        return maybeText(record, 'name') ?? ''
    }
  }
  const targets = recordsOf[home]
    .map((record) => ({ value: String(record['id']), label: labelOf(record) }))
    .sort((left, right) => byNameIn(left.label, right.label))
  const chosen = recordsOf[home].find((record) => record['id'] === target)

  async function report() {
    const values = {
      [home]: target === '' ? null : target,
      description: description.trim(),
      foundOn,
      ...(keeps && defectClass !== '' ? { defectClass } : {}),
      ...(keeps && dueOn !== '' ? { dueOn } : {}),
    }
    const found: Record<string, string> = {
      ...defectProblems({ ...values, description: values.description }, today()),
    }

    if (target === '') {
      found['target'] = defectWords.noPlace
    }

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const made = await makeAt(client, '/defects', values)

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      const propertyId = home === 'propertyId' ? target : String(chosen?.['propertyId'] ?? '')

      for (const photo of photos) {
        const problem = await fileDocument(client, { propertyId, defectId: made.id }, photo)

        if (problem !== null) {
          setTrouble(problem)
        }
      }

      await queries.invalidateQueries({ queryKey: ['defects'] })
      await queries.invalidateQueries({ queryKey: ['assets'] })
      void navigate({ to: defectPlaces.defect(made.id) })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Screen>
      <PageHead
        title="Mangel melden"
        sub="Ein Mangel hängt immer an einer Anlage oder einem Ort"
        crumbs={[defectListPlace]}
        phoneBack={defectListPlace}
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Panel>
            <form
              id={formId}
              noValidate
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void report()
              }}
            >
              <Choice<Home>
                label="Woran"
                value={home}
                disabled={working}
                onChange={(value) => {
                  setHome(value)
                  setTarget('')
                }}
                options={(Object.keys(homeLabel) as Home[]).map((each) => ({
                  value: each,
                  label: homeLabel[each],
                }))}
              />
              <SelectField
                label={homeLabel[home]}
                required
                starred
                value={target}
                options={[{ value: '', label: 'Bitte wählen' }, ...targets]}
                onChange={setTarget}
                {...(problems['target'] ? { problem: problems['target'] } : {})}
              />
              <TextArea
                label="Beschreibung"
                rows={3}
                required
                starred
                maxLength={defectLimits.description}
                value={description}
                problem={problems['description']}
                onChange={(event) => {
                  setDescription(event.target.value)
                }}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Fotos</span>
                <div className="flex flex-wrap items-center gap-2.5">
                  {photos.map((photo) => (
                    <span
                      key={`${photo.name}-${String(photo.size)}`}
                      className="rounded-control border border-line px-2 py-1 text-[12px] text-ink-muted"
                    >
                      {photo.name}
                    </span>
                  ))}
                  <Button
                    size="small"
                    disabled={working}
                    onClick={() => {
                      picker.current?.click()
                    }}
                  >
                    Foto hinzufügen
                  </Button>
                  <input
                    ref={picker}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    aria-label="Foto hinzufügen"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])]

                      setPhotos((before) => [...before, ...files])
                      event.target.value = ''
                    }}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Festgestellt am"
                  type="date"
                  value={foundOn}
                  onChange={(event) => {
                    setFoundOn(event.target.value)
                  }}
                  {...(problems['foundOn'] ? { problem: problems['foundOn'] } : {})}
                />
                {keeps ? (
                  <>
                    <SelectField
                      label="Klasse"
                      value={defectClass}
                      hint="Bestimmt die Vorgabe der Frist."
                      options={[
                        { value: '', label: 'Ohne Klasse' },
                        ...(classes.data ?? []).map((each) => ({
                          value: each.key,
                          label: each.label,
                        })),
                      ]}
                      onChange={(value) => {
                        setDefectClass(value)
                        const proposed = defaultDueOn(
                          foundOn,
                          classes.data?.find((each) => each.key === value)?.dueDays ?? null,
                        )

                        if (proposed !== null) {
                          setDueOn(proposed)
                        }
                      }}
                      {...(problems['defectClass'] ? { problem: problems['defectClass'] } : {})}
                    />
                    <Field
                      label="Frist zur Beseitigung"
                      type="date"
                      value={dueOn}
                      {...(choice?.dueDays === null || choice === undefined
                        ? {}
                        : { hint: `Vorgabe der Klasse: ${String(choice.dueDays)} Tage.` })}
                      onChange={(event) => {
                        setDueOn(event.target.value)
                      }}
                      {...(problems['dueOn'] ? { problem: problems['dueOn'] } : {})}
                    />
                  </>
                ) : null}
              </div>
              {keeps && classes.isError ? (
                <p role="alert" className="text-[13px] font-semibold text-conflict">
                  {defectWords.classesFailed}
                </p>
              ) : null}
              {keeps ? null : (
                <p className="text-[13px] text-ink-muted">{defectWords.reportWithout}</p>
              )}
              {trouble ? (
                <p role="alert" className="text-[13px] font-semibold text-conflict">
                  {trouble}
                </p>
              ) : null}
            </form>
          </Panel>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={working}
              onClick={() => {
                void navigate({ to: defectListPlace.to })
              }}
            >
              Abbrechen
            </Button>
            <Button type="submit" form={formId} tone="primary" icon={Check} disabled={working}>
              Mangel melden
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Gut zu wissen">
            <div className="flex flex-col gap-2 text-[13px] leading-[1.45]">
              <p>{defectWords.reportedBy}</p>
              <p>{defectWords.photosAfter}</p>
              <p>{defectWords.outOfService}</p>
            </div>
          </Panel>
        </div>
      </div>
    </Screen>
  )
}
