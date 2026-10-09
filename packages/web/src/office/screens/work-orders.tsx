import {
  activityClosable,
  activityKindOfTask,
  activityLimits,
  activityProblems,
  type DefectRegister,
  durationWords,
  type DutyDetails,
  type DutyPerson,
  type RecordState,
  signatureLimits,
  type WorkOrderCandidates,
  type WorkOrderDetails,
  type WorkOrderEntry,
  type WorkOrderKind,
  workOrderKindLabel,
  workOrderKinds,
  type WorkOrderList,
  type WorkOrderListState,
  workOrderListStateLabel,
  workOrderListStates,
  type WorkOrderOriginKind,
  workOrderOriginLabel,
  workOrderOrigins,
  workOrderPlanProblems,
  type WorkOrderUrgency,
  workOrderUrgencies,
  workOrderUrgencyLabel,
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
  NumberBadge,
  Panel,
  SelectField,
  SignaturePicture,
  Status,
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
import { Ban, Check, Pencil, Plus, Signature, TriangleAlert, X } from 'lucide-react'
import { type ReactNode, useDeferredValue, useId, useMemo, useState } from 'react'

import { titleOfRoom } from '../../app/place-records.js'
import { useAreas } from '../../session/areas.js'
import { askAt, makeAt } from '../../sync/made-at.js'
import { defectPlaces } from '../defect-addresses.js'
import { DocumentsCard } from '../documents.js'
import { dutyPlaces, dutyRegisterPlace } from '../duty-addresses.js'
import { factLink } from '../links.js'
import { RegisterFilter } from '../register-filter.js'
import {
  workOrderFilterOf,
  type WorkOrderListAddress,
  workOrderListPlace,
  workOrderListRequest,
  workOrderPlaces,
  workOrderSearch,
  type WorkOrderStart,
  workOrderStartOf,
  workOrderStartSearch,
} from '../work-order-addresses.js'
import { ActivityStatusMark, usePlaces } from './activities.js'

export const workOrderWords = {
  sub: 'Aufträge aus Mängeln, aus Terminen der Pflichten und von Hand, der neueste zuerst.',
  searchLabel: 'Aufträge durchsuchen',
  searchPlaceholder: 'Nummer, Auftrag, Liegenschaft …',
  note: 'Ein zurückgewiesener Auftrag ist wieder offen; seine Unterschrift bleibt stehen und gilt nicht mehr.',
  noConnection: 'Die Aufträge kommen vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Aufträge werden geladen.',
  failed: 'Die Aufträge ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  nothingPasses: 'Kein Auftrag passt zu dem, wonach die Liste eingegrenzt ist.',
  none: 'Noch gibt es keinen Auftrag. Einer entsteht aus einem Mangel, aus dem Termin einer Pflicht oder von Hand.',
  nobody: 'noch niemand',
  late: 'überschritten',
  notThere:
    'Diesen Auftrag gibt es nicht, oder er liegt außerhalb dessen, was dieser Zugang sieht.',
  pageNoConnection: 'Ein Auftrag kommt vom Server. Gerade ist keine Verbindung da.',
  pageLoading: 'Der Auftrag wird geladen.',
  pageFailed: 'Der Auftrag ließ sich nicht laden. Er kommt vom Server, mit Verbindung.',
  acceptance:
    'Abnehmen bestätigt die Arbeit, wie sie hier steht, und erledigt den Auftrag. Eine Zurückweisung macht die Unterschrift ungültig und lässt sie stehen; der Auftrag ist dann wieder offen.',
  reasonPlaceholder: 'Nur beim Zurückweisen, Pflicht',
  notSigned:
    'Noch nicht unterschrieben. Abschließen kann den Auftrag nur, wer ihn führt, mit der Unterschrift vor Ort.',
  later: 'Der Leistungsnachweis für den Auftraggeber kommt mit Phase 2 (4.8).',
  laterMaterial: 'Material aus dem Lager am Auftrag kommt mit Phase 2 (4.12).',
  peopleFailed: 'Wer zur Wahl steht, ließ sich nicht laden. Das braucht eine Verbindung.',
  fromDefect:
    'Der Mangel steht mit dem Anlegen auf „Beauftragt“. Ist der Auftrag unterschrieben, steht er auf „Behoben“.',
  fromDuty:
    'Der Auftrag erfüllt den Termin der Pflicht: mit seiner Abnahme entsteht ihr Nachweis, und der Termin rückt weiter.',
  byHand: 'Ein Auftrag von Hand hängt an der Anlage oder dem Ort, an dem die Arbeit ist.',
  whoFinishes:
    'Abschließen kann den Auftrag nur die verantwortliche Person; abnehmen die Objektleitung oder wer ihn angelegt hat.',
  dutyFromPage:
    'Einen Auftrag für einen Termin legt an, wer auf der Seite der Pflicht „Auftrag anlegen“ wählt.',
  noDefects: 'Es gibt keinen festgestellten Mangel ohne Auftrag.',
  defectsFailed: 'Die Mängel ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  takenFromDefect: 'Aus dem Mangel übernommen.',
  takenFromDuty: 'Von der Pflicht übernommen.',
  defectDue: 'Die Frist des Mangels.',
  appointment: 'Der Termin der Pflicht.',
  noPlace: 'Ein Auftrag hängt an einer Anlage oder einem Ort.',
  noDefect: 'Ein Auftrag aus einem Mangel nennt den Mangel.',
  nobodyFurther: 'Niemand weiter beteiligt.',
  noDuration: 'Noch nicht angegeben',
  duration: (minutes: number) => `${durationWords(minutes)} Std.`,
  noNotes: 'Noch keine Notiz von vor Ort.',
  noOrders: 'Kein offener Auftrag.',
  ordersFailed: 'Die Aufträge ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  closingHint: 'Der Grund steht am Auftrag und bleibt lesbar.',
  whatClosingDoes:
    'Der Auftrag ist damit geschlossen, auch auf den Geräten, und lässt sich nicht wieder öffnen. Der Mangel, aus dem er kam, steht wieder auf „Festgestellt“ und braucht einen neuen Auftrag. Der Termin einer Pflicht bleibt, wie er ist.',
} as const

/** The work orders of the office in the cache: every list and every page. */
const workOrderKey = ['work-orders'] as const

export function workOrderQuery(id: string) {
  return {
    queryKey: [...workOrderKey, 'page', id],
    queryFn: () => request<WorkOrderDetails>(`/work-orders/${id}`),
  } as const
}

function candidatesQuery(propertyId: string) {
  return {
    queryKey: [...workOrderKey, 'candidates', propertyId],
    queryFn: () => request<WorkOrderCandidates>(`/work-orders/candidates?property=${propertyId}`),
  } as const
}

/**
 * How far a work order is, `status()` of the boards: turned back while it is
 * begun again, waiting for its acceptance once signed, accepted once done,
 * and otherwise the state of its activity.
 */
export function WorkOrderStatusMark({
  order,
}: {
  readonly order: Pick<WorkOrderEntry, 'status' | 'rejected'>
}) {
  if (order.rejected) {
    return (
      <Status tone="conflict" icon={X}>
        Zurückgewiesen
      </Status>
    )
  }

  if (order.status === 'signed') {
    return (
      <Status tone="waiting" icon={Signature}>
        Wartet auf Abnahme
      </Status>
    )
  }

  if (order.status === 'done') {
    return (
      <Status tone="done" icon={Check}>
        Abgenommen
      </Status>
    )
  }

  return <ActivityStatusMark status={order.status} />
}

/** How urgent an order is, in a cell: "normal" plainly, the other two to be seen. */
function UrgencyWord({ urgency }: { readonly urgency: WorkOrderUrgency }) {
  return urgency === 'normal' ? (
    <span>{workOrderUrgencyLabel[urgency]}</span>
  ) : (
    <span className="font-semibold text-conflict">{workOrderUrgencyLabel[urgency]}</span>
  )
}

/** Whether an order still to be done is past its day. */
function isLate(order: Pick<WorkOrderEntry, 'dueOn' | 'status'>): boolean {
  return (
    order.dueOn !== null &&
    order.dueOn < today() &&
    (activityClosable as readonly string[]).concat('signed').includes(order.status)
  )
}

function DueCell({ order }: { readonly order: WorkOrderEntry }) {
  if (order.dueOn === null) {
    return <span className="text-ink-faint">{workOrderWords.nobody}</span>
  }

  return isLate(order) ? (
    <div className="leading-[1.32]">
      <div className="font-semibold text-conflict">{date(order.dueOn)}</div>
      <div className="text-[12px] text-conflict">{workOrderWords.late}</div>
    </div>
  ) : (
    <span>{date(order.dueOn)}</span>
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

/** "7 offen, davon 1 wartet auf Abnahme", "3 abgenommen": how many the list holds in the state it shows. */
function countOf(list: WorkOrderList, state: WorkOrderListState): string {
  const total = list.total.toLocaleString('de-DE')

  switch (state) {
    case 'open':
      return list.waiting === 0
        ? `${total} offen`
        : `${total} offen, davon ${list.waiting.toLocaleString('de-DE')} ${list.waiting === 1 ? 'wartet' : 'warten'} auf Abnahme`
    case 'waiting':
      return `${total} ${list.total === 1 ? 'wartet' : 'warten'} auf Abnahme`
    case 'accepted':
      return `${total} abgenommen`
    case 'all':
      return `${total} insgesamt`
  }
}

/**
 * "Aufträge" in the office, the board "Aufträge (4.8)" (#117): the work orders
 * the person sees, the newest first, with number, what each is and where, how
 * urgent, its day, who leads it and how far it is.
 *
 * The list comes from the server a page at a time and is narrowed there; it
 * needs a connection and says so without one. Whoever plans and hands out
 * work sees every order in their areas; whoever only performs sees what they
 * lead, work on, or what is given to nobody. There is no narrowing to a
 * person: a list of what somebody worked on would count their work.
 */
export function WorkOrderListScreen() {
  const address = useSearch({ strict: false })
  const filter = useMemo(() => workOrderFilterOf(address), [address])
  const navigate = useNavigate()
  const areas = useAreas()
  const whereOf = usePlaces()
  const plans = useRight('activity.write')
  const [search, setSearch] = useState('')
  const wanted = useDeferredValue(search.trim())
  const state = filter.state ?? 'open'

  const pages = useInfiniteQuery({
    queryKey: [...workOrderKey, 'list', filter, wanted],
    queryFn: ({ pageParam }) =>
      request<WorkOrderList>(workOrderListRequest(filter, wanted, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.more ? all.reduce((sum, page) => sum + page.orders.length, 0) : undefined,
    placeholderData: keepPreviousData,
    // A refusal is an answer: asking again brings the same one.
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  const first = pages.data?.pages[0]
  const orders = pages.data?.pages.flatMap((page) => page.orders) ?? []
  const narrowed = Object.keys(filter).some((name) => name !== 'state') || wanted !== ''

  /** The filter with one part set, or without it for the choice "all". */
  const set = (name: keyof WorkOrderListAddress, value: string) => {
    const { [name]: _, ...rest } = filter

    void navigate({
      to: workOrderListPlace.to,
      search: workOrderSearch(value === '' ? rest : { ...rest, [name]: value }),
      replace: true,
    })
  }

  return (
    <Screen>
      <PageHead
        title="Aufträge"
        sub={workOrderWords.sub}
        {...(first === undefined ? {} : { count: countOf(first, state) })}
        actions={
          plans ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                void navigate({ to: workOrderPlaces.new })
              }}
            >
              Neuer Auftrag
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <label className="sr-only" htmlFor="work-order-search">
          {workOrderWords.searchLabel}
        </label>
        <input
          id="work-order-search"
          type="search"
          value={search}
          placeholder={workOrderWords.searchPlaceholder}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
          className="h-8 w-[240px] rounded-control border border-line-strong bg-surface px-2.5 text-[14px] text-ink max-lg:h-10 max-lg:w-full"
        />
        <div role="group" aria-label="Stand" className="flex flex-wrap gap-1.5">
          {workOrderListStates.map((each) => (
            <Chip
              key={each}
              pressed={state === each}
              onPress={() => {
                set('state', each === 'open' ? '' : each)
              }}
            >
              {workOrderListStateLabel[each]}
            </Chip>
          ))}
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5 max-lg:w-full">
          <RegisterFilter
            label="Art"
            className="lg:w-[170px]"
            value={filter.kind ?? ''}
            onChange={(value) => {
              set('kind', value)
            }}
          >
            <option value="">Alle Arten</option>
            {workOrderKinds.map((kind) => (
              <option key={kind} value={kind}>
                {workOrderKindLabel[kind]}
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
        </div>
      </div>
      {first === undefined ? (
        <Panel>
          <Empty>
            {pages.isError
              ? workOrderWords.failed
              : pages.fetchStatus === 'paused'
                ? workOrderWords.noConnection
                : workOrderWords.loading}
          </Empty>
        </Panel>
      ) : orders.length === 0 ? (
        <Panel>
          <Empty>
            {narrowed || state !== 'open' ? workOrderWords.nothingPasses : workOrderWords.none}
          </Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Aufträge mit Nummer, Ort oder Anlage, Dringlichkeit, Frist, Verantwortlichem und Stand"
          note={workOrderWords.note}
          cards={orders.map((order) => {
            const where = whereOf(order)

            return {
              key: order.id,
              title: (
                <Link to={workOrderPlaces.order(order.id)} className={cardLink}>
                  {order.title}
                </Link>
              ),
              sub: [
                order.number,
                order.dueOn === null ? null : date(order.dueOn),
                where.name,
                order.urgency === 'normal' ? null : workOrderUrgencyLabel[order.urgency],
                order.responsible?.name,
              ]
                .filter((part) => part !== null && part !== undefined && part !== '')
                .join(' · '),
              right: <WorkOrderStatusMark order={order} />,
            }
          })}
          footer={
            <>
              <span>
                {`${orders.length.toLocaleString('de-DE')} von ${first.total.toLocaleString('de-DE')}`}
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
              <Column className="w-[120px] min-w-[112px]">Nummer</Column>
              <Column className="min-w-[180px]">Auftrag</Column>
              <Column className="w-[236px] min-w-[160px]">Ort oder Anlage</Column>
              <Column className="w-[110px] min-w-[100px]">Dringlichkeit</Column>
              <Column className="w-[110px] min-w-[100px]">Frist</Column>
              <Column className="w-[140px] min-w-[120px]">Verantwortlich</Column>
              <Column className="w-[180px] min-w-[150px]">Stand</Column>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const where = whereOf(order)

              return (
                <tr key={order.id}>
                  <Cell>
                    <span className="text-ink-muted">{order.number}</span>
                  </Cell>
                  <Cell>
                    <TwoLines
                      bold
                      main={
                        <Link to={workOrderPlaces.order(order.id)} className={factLink}>
                          {order.title}
                        </Link>
                      }
                      sub={workOrderKindLabel[order.kind]}
                    />
                  </Cell>
                  <Cell>
                    <TwoLines main={<Link to={where.to}>{where.name}</Link>} sub={where.sub} />
                  </Cell>
                  <Cell>
                    <UrgencyWord urgency={order.urgency} />
                  </Cell>
                  <Cell>
                    <DueCell order={order} />
                  </Cell>
                  <Cell>
                    {order.responsible?.name ?? (
                      <span className="text-ink-faint">{workOrderWords.nobody}</span>
                    )}
                  </Cell>
                  <Cell>
                    <WorkOrderStatusMark order={order} />
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

/** Where an order came from, as a fact with the way to it. */
function OriginFact({ order }: { readonly order: WorkOrderDetails }) {
  const { origin } = order

  switch (origin.kind) {
    case 'defect':
      return (
        <span>
          <Link to={defectPlaces.defect(origin.defectId)} className={factLink}>
            {`Mangel „${origin.description}“`}
          </Link>
          {`, festgestellt am ${date(origin.foundOn)}`}
        </span>
      )
    case 'duty':
      return (
        <span>
          <Link to={dutyPlaces.duty(origin.dutyId)} className={factLink}>
            {`Termin der Pflicht „${origin.title}“`}
          </Link>
        </span>
      )
    case 'hand':
      return <span>Von Hand</span>
  }
}

/**
 * The page of a work order, the board "Auftrag mit Abnahme (4.8)" (#117):
 * what it is, where it came from, where, its day, who leads it and who works
 * on it, the time spent on it, the notes and the photos from the site (#118),
 * its signature and its acceptance.
 *
 * Whoever plans and hands out work changes it until it is signed. Whoever
 * accepts work orders accepts a signed one or turns it back with the reason,
 * which leaves the signature standing and invalid.
 */
export function WorkOrderScreen() {
  const { orderId } = useParams({ strict: false }) as { orderId?: string }
  const page = useQuery({ ...workOrderQuery(orderId ?? ''), enabled: orderId !== undefined })
  const shown = page.data
  const whereOf = usePlaces()
  const plans = useRight('activity.write')
  const accepts = useRight('activity.accept')
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(false)

  if (shown === undefined || orderId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Auftrag'}
          crumbs={[workOrderListPlace]}
          phoneBack={workOrderListPlace}
        />
        <Empty>
          {gone
            ? workOrderWords.notThere
            : page.isError
              ? workOrderWords.pageFailed
              : page.fetchStatus === 'paused'
                ? workOrderWords.pageNoConnection
                : workOrderWords.pageLoading}
        </Empty>
      </Screen>
    )
  }

  const where = whereOf(shown)
  const changes = plans && (activityClosable as readonly string[]).includes(shown.status)
  const signatures = [...shown.signatures].reverse()

  return (
    <Screen>
      <PageHead
        title={shown.title}
        crumbs={[
          workOrderListPlace,
          ...(shown.number === null
            ? []
            : [{ to: workOrderPlaces.order(shown.id), label: shown.number }]),
        ]}
        phoneBack={workOrderListPlace}
        badges={
          <>
            {shown.number === null ? null : <NumberBadge>{shown.number}</NumberBadge>}
            <WorkOrderStatusMark order={shown} />
          </>
        }
        tags={
          shown.urgency === 'normal' ? undefined : (
            <Status tone="conflict" icon={TriangleAlert}>
              {workOrderUrgencyLabel[shown.urgency]}
            </Status>
          )
        }
        actions={
          <>
            <ChangesButton table="activities" id={shown.id} />
            {/* Closed with the reason before its signature (v0.19 of the concept). */}
            {changes ? (
              <Button
                icon={Ban}
                onClick={() => {
                  setClosing(true)
                }}
              >
                Nicht durchgeführt
              </Button>
            ) : null}
            {changes ? (
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
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Auftrag">
            <FactList
              keyWidth={110}
              facts={[
                { label: 'Art', value: workOrderKindLabel[shown.kind] },
                { label: 'Ursprung', value: <OriginFact order={shown} /> },
                {
                  label: 'Ort',
                  value: (
                    <span>
                      <Link to={where.to} className={factLink}>
                        {where.name}
                      </Link>
                      {where.sub === '' || where.sub === where.name ? null : `, ${where.sub}`}
                    </span>
                  ),
                },
                {
                  label: 'Frist',
                  value:
                    shown.dueOn === null
                      ? null
                      : isLate(shown)
                        ? `${date(shown.dueOn)}, ${workOrderWords.late}`
                        : date(shown.dueOn),
                },
                { label: 'Angelegt', value: `am ${date(shown.createdAt.slice(0, 10))}` },
                { label: 'Verantwortlich', value: shown.responsible?.name ?? null },
                {
                  label: 'Beteiligt',
                  value:
                    shown.participants.length === 0 ? (
                      <span className="text-ink-faint">{workOrderWords.nobodyFurther}</span>
                    ) : (
                      shown.participants.map((person) => person.name).join(', ')
                    ),
                },
                {
                  label: 'Dauer',
                  value:
                    shown.durationMinutes === null ? (
                      <span className="text-ink-faint">{workOrderWords.noDuration}</span>
                    ) : (
                      workOrderWords.duration(shown.durationMinutes)
                    ),
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
          <Panel title="Notizen von vor Ort">
            {shown.notes.length === 0 ? (
              <p className="text-[13px] leading-[1.45] text-ink-muted">{workOrderWords.noNotes}</p>
            ) : (
              <ul aria-label="Notizen von vor Ort" className="flex flex-col">
                {shown.notes.map((note) => (
                  <li
                    key={note.id}
                    className="border-b border-row py-2 leading-[1.45] last:border-b-0"
                  >
                    <p className="text-[14px] whitespace-pre-line [overflow-wrap:anywhere]">
                      {note.text}
                    </p>
                    <p className="text-[12px] text-ink-faint">{`${moment(note.writtenAt)}, ${note.name}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <DocumentsCard
            title="Fotos von vor Ort"
            place={{ propertyId: shown.propertyId, activityId: shown.id }}
            at={`Auftrag „${shown.title}“`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Unterschrift">
            {signatures.length === 0 ? (
              <p className="text-[13px] leading-[1.45] text-ink-muted">
                {workOrderWords.notSigned}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {signatures.map((signature) => (
                  <li
                    key={`${signature.signedAt}-${signature.name}`}
                    className="flex items-center gap-3"
                  >
                    <div className="w-[180px] shrink-0 rounded-control border border-line bg-surface p-1 max-sm:w-[120px]">
                      <SignaturePicture
                        path={signature.path}
                        label={`Unterschrift von ${signature.name}`}
                        className="block aspect-[5/2] w-full"
                      />
                    </div>
                    <div className="min-w-0 leading-[1.4]">
                      <div className="font-semibold">{signature.name}</div>
                      <div className="text-[13px] text-ink-muted">
                        {`abgeschlossen am ${moment(signature.signedAt)}`}
                      </div>
                      {signature.valid ? null : (
                        <div className="text-[13px] font-semibold text-conflict">
                          gilt nicht mehr
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <AcceptancePanel order={shown} accepts={accepts} />
          <Panel title="Später">
            <p className="text-[12px] leading-[1.4] text-ink-muted">{workOrderWords.later}</p>
          </Panel>
        </div>
      </div>
      {closing ? (
        <CloseWorkOrderDialog
          key={shown.id}
          order={shown}
          sub={where.name}
          onClose={() => {
            setClosing(false)
          }}
        />
      ) : null}
      {editing ? (
        <EditWorkOrderDialog
          key={shown.id}
          order={shown}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

/**
 * "Abnahme": what was decided on the order so far, and for whoever accepts
 * work orders, while the order is signed, accepting it or turning it back
 * with the reason. Asked of the route, with a connection.
 */
function AcceptancePanel({
  order,
  accepts,
}: {
  readonly order: WorkOrderDetails
  readonly accepts: boolean
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const deciding = accepts && order.status === 'signed'

  async function decide(decision: 'accepted' | 'rejected') {
    const said = reason.trim()

    setTrouble(null)

    if (decision === 'rejected' && said === '') {
      setProblem('Eine Zurückweisung nennt ihren Grund.')

      return
    }

    setProblem(undefined)
    setWorking(true)

    try {
      const result = await askAt(
        client,
        'POST',
        `/work-orders/${order.id}/decision`,
        order.id,
        decision === 'rejected' ? { decision, reason: said } : { decision },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      setReason('')
      // The order, the list, the defect it sets right and the duty it meets.
      await queries.invalidateQueries({ queryKey: workOrderKey })
      await queries.invalidateQueries({ queryKey: ['defects'] })
      await queries.invalidateQueries({ queryKey: ['duties'] })
    } finally {
      setWorking(false)
    }
  }

  if (!deciding && order.decisions.length === 0) {
    return null
  }

  return (
    <Panel title="Abnahme">
      <div className="flex flex-col gap-3">
        {order.decisions.length === 0 ? null : (
          <ul className="flex flex-col gap-1.5 text-[13px] leading-[1.45]">
            {order.decisions.map((decision) => (
              <li key={decision.decidedAt}>
                <span className="font-semibold">
                  {decision.decision === 'accepted' ? 'Abgenommen' : 'Zurückgewiesen'}
                </span>
                {` am ${moment(decision.decidedAt)} von ${decision.name}`}
                {decision.reason === null ? null : `: ${decision.reason}`}
              </li>
            ))}
          </ul>
        )}
        {deciding ? (
          <>
            <p className="text-[13px] leading-[1.45] text-ink-muted">{workOrderWords.acceptance}</p>
            <TextArea
              label="Begründung"
              rows={3}
              maxLength={signatureLimits.decisionReason}
              placeholder={workOrderWords.reasonPlaceholder}
              value={reason}
              problem={problem}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
            {trouble ? (
              <p role="alert" className="text-[13px] font-semibold text-conflict">
                {trouble}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                tone="danger"
                icon={X}
                disabled={working}
                onClick={() => {
                  void decide('rejected')
                }}
              >
                Zurückweisen
              </Button>
              <Button
                tone="primary"
                icon={Check}
                disabled={working}
                onClick={() => {
                  void decide('accepted')
                }}
              >
                Abnehmen
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * "Nicht durchgeführt", the board "Auftrag mit Grund schließen (4.8)" (v0.19
 * of the concept): an open or begun work order closed with the reason. Its
 * defect is found again and waits for a new order; the appointment of a duty
 * stays as it is. Asked of the route, with a connection, and not taken back.
 */
function CloseWorkOrderDialog({
  order,
  sub,
  onClose,
}: {
  readonly order: WorkOrderDetails
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
      const result = await askAt(client, 'POST', `/work-orders/${order.id}/close`, order.id, values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The order, the list, the defect it was to set right and the duty it was to meet.
      await queries.invalidateQueries({ queryKey: workOrderKey })
      await queries.invalidateQueries({ queryKey: ['defects'] })
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
      sub={[[order.number, order.title].filter(Boolean).join(' '), sub].filter(Boolean).join(', ')}
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
          hint={workOrderWords.closingHint}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox>{workOrderWords.whatClosingDoes}</NoteBox>
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

/** The people on offer, and those named before where they are not among them, so that a choice shows who it is. */
function offeredWith(
  offered: readonly DutyPerson[] | undefined,
  named: readonly DutyPerson[],
): DutyPerson[] {
  return [
    ...(offered ?? []),
    ...named.filter((person) => !(offered ?? []).some((each) => each.userId === person.userId)),
  ]
}

/**
 * The plan of a work order as both forms edit it: its title and kind, how
 * urgent, its day, who leads it and the further people. The people to choose
 * from perform and see the area of the property; the server asks again.
 */
interface PlanState {
  readonly title: string
  readonly kind: WorkOrderKind
  readonly urgency: WorkOrderUrgency
  readonly dueOn: string
  readonly responsibleUserId: string
  readonly participantUserIds: readonly string[]
}

function PlanFields({
  plan,
  onChange,
  people,
  peopleFailed,
  problems,
  disabled,
  dueHint,
}: {
  readonly plan: PlanState
  readonly onChange: (plan: PlanState) => void
  readonly people: readonly DutyPerson[]
  readonly peopleFailed: boolean
  readonly problems: Readonly<Record<string, string>>
  readonly disabled: boolean
  readonly dueHint?: string | undefined
}) {
  const set = <Name extends keyof PlanState>(name: Name, value: PlanState[Name]) => {
    onChange({ ...plan, [name]: value })
  }
  const nameOf = (userId: string) =>
    people.find((person) => person.userId === userId)?.name ?? 'Unbekanntes Konto'
  const addable = people.filter(
    (person) =>
      person.userId !== plan.responsibleUserId && !plan.participantUserIds.includes(person.userId),
  )

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Field
          label="Titel"
          required
          starred
          maxLength={activityLimits.title}
          value={plan.title}
          disabled={disabled}
          onChange={(event) => {
            set('title', event.target.value)
          }}
          {...(problems['title'] ? { problem: problems['title'] } : {})}
        />
        <SelectField
          label="Art"
          value={plan.kind}
          onChange={(value) => {
            set('kind', value as WorkOrderKind)
          }}
          options={workOrderKinds.map((kind) => ({ value: kind, label: workOrderKindLabel[kind] }))}
          {...(problems['kind'] ? { problem: problems['kind'] } : {})}
        />
      </div>
      <Choice<WorkOrderUrgency>
        label="Dringlichkeit"
        value={plan.urgency}
        disabled={disabled}
        onChange={(value) => {
          set('urgency', value)
        }}
        options={workOrderUrgencies.map((urgency) => ({
          value: urgency,
          label: workOrderUrgencyLabel[urgency],
        }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Frist"
          type="date"
          value={plan.dueOn}
          disabled={disabled}
          {...(dueHint === undefined ? {} : { hint: dueHint })}
          onChange={(event) => {
            set('dueOn', event.target.value)
          }}
          {...(problems['dueOn'] ? { problem: problems['dueOn'] } : {})}
        />
        <SelectField
          label="Verantwortlich"
          value={plan.responsibleUserId}
          onChange={(value) => {
            onChange({
              ...plan,
              responsibleUserId: value,
              participantUserIds: plan.participantUserIds.filter((userId) => userId !== value),
            })
          }}
          options={[
            { value: '', label: 'Bitte wählen' },
            ...people.map((person) => ({ value: person.userId, label: person.name })),
          ]}
          {...(problems['responsibleUserId'] ? { problem: problems['responsibleUserId'] } : {})}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Weitere Beteiligte</span>
        <div className="flex flex-wrap items-center gap-2">
          {plan.participantUserIds.map((userId) => (
            <span
              key={userId}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-2.5 py-1 text-[13px]"
            >
              {nameOf(userId)}
              <button
                type="button"
                aria-label={`${nameOf(userId)} entfernen`}
                disabled={disabled}
                className="text-ink-muted hover:text-ink"
                onClick={() => {
                  set(
                    'participantUserIds',
                    plan.participantUserIds.filter((each) => each !== userId),
                  )
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
          {addable.length === 0 ? null : (
            <label className="inline-flex items-center gap-1.5 text-[13px]">
              <span className="sr-only">Person hinzufügen</span>
              <select
                value=""
                disabled={disabled}
                className="h-8 rounded-control border border-line-strong bg-surface px-2 text-[13px] text-ink"
                onChange={(event) => {
                  if (event.target.value !== '') {
                    set('participantUserIds', [...plan.participantUserIds, event.target.value])
                  }
                }}
              >
                <option value="">+ Person hinzufügen</option>
                {addable.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {problems['participantUserIds'] ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {problems['participantUserIds']}
          </p>
        ) : null}
      </div>
      {peopleFailed ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {workOrderWords.peopleFailed}
        </p>
      ) : null}
    </>
  )
}

/** The plan as the route takes it. */
function planBody(plan: PlanState) {
  return {
    title: plan.title.trim(),
    kind: plan.kind,
    urgency: plan.urgency,
    dueOn: plan.dueOn === '' ? null : plan.dueOn,
    responsibleUserId: plan.responsibleUserId === '' ? null : plan.responsibleUserId,
    participantUserIds: [...plan.participantUserIds],
  }
}

/**
 * "Bearbeiten" on the page of a work order, for whoever plans and hands out
 * work, until it is signed. Asked of the route, with a connection.
 */
function EditWorkOrderDialog({
  order,
  onClose,
}: {
  readonly order: WorkOrderDetails
  readonly onClose: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const candidates = useQuery(candidatesQuery(order.propertyId))
  const formId = useId()
  const [plan, setPlan] = useState<PlanState>({
    title: order.title,
    kind: order.kind,
    urgency: order.urgency,
    dueOn: order.dueOn ?? '',
    responsibleUserId: order.responsible?.userId ?? '',
    participantUserIds: order.participants.map((person) => person.userId),
  })
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const people = offeredWith(candidates.data?.people, [
    ...(order.responsible === null ? [] : [order.responsible]),
    ...order.participants,
  ])

  async function save() {
    const body = planBody(plan)
    const found = workOrderPlanProblems(body)

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(client, 'PUT', `/work-orders/${order.id}`, order.id, body)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: workOrderKey })
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Auftrag bearbeiten"
      width={640}
      onClose={onClose}
      sub={[order.number, order.title].filter(Boolean).join(' ')}
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <PlanFields
          plan={plan}
          onChange={setPlan}
          people={people}
          peopleFailed={candidates.isError}
          problems={problems}
          disabled={working}
        />
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
            {working ? 'Einen Moment' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** What a work order by hand hangs on, as the form asks it. */
type Home = 'assetId' | 'roomId' | 'buildingId' | 'propertyId'

const homeLabel: Readonly<Record<Home, string>> = {
  assetId: 'Anlage',
  roomId: 'Raum',
  buildingId: 'Gebäude',
  propertyId: 'Liegenschaft',
}

/** The found defects without an order, which a new one may come of. */
const foundDefectsQuery = {
  queryKey: ['defects', 'found-for-orders'],
  queryFn: async () => {
    const register = await request<DefectRegister>('/defects?state=open&limit=200')

    return register.defects.filter((defect) => defect.status === 'found')
  },
} as const

/**
 * "Neuer Auftrag", the board "Neuer Auftrag aus einem Mangel (4.8)" (#117):
 * from a found defect, from the due day of a duty or by hand, with its title
 * and kind, how urgent, its day, the person who leads it and the further
 * people. A defect, a duty or an asset hands what it starts from in the
 * address. The number is drawn by the server; the order is made at the
 * route, with a connection, and its page opens.
 */
export function NewWorkOrderScreen() {
  const address = useSearch({ strict: false })
  const start = useMemo<WorkOrderStart>(() => workOrderStartOf(address), [address])
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const formId = useId()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const assets = useRecords('assets')
  const [origin, setOrigin] = useState<WorkOrderOriginKind>(
    start.dutyId !== undefined ? 'duty' : start.assetId !== undefined ? 'hand' : 'defect',
  )
  const [defectId, setDefectId] = useState(start.defectId ?? '')
  const [home, setHome] = useState<Home>('assetId')
  const [target, setTarget] = useState(start.assetId ?? '')
  const [plan, setPlan] = useState<PlanState>({
    title: '',
    kind: start.assetId === undefined ? 'defect_remedy' : 'other',
    urgency: 'normal',
    dueOn: '',
    responsibleUserId: '',
    participantUserIds: [],
  })
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const defects = useQuery({ ...foundDefectsQuery, enabled: origin === 'defect' })
  const duty = useQuery({
    queryKey: ['duties', 'page', start.dutyId ?? ''],
    queryFn: () => request<DutyDetails>(`/duties/${start.dutyId ?? ''}`),
    enabled: origin === 'duty' && start.dutyId !== undefined,
  })
  const defect = defects.data?.find((each) => each.id === defectId)

  const recordsOf: Readonly<Record<Home, readonly RecordState[]>> = {
    assetId: assets,
    roomId: rooms,
    buildingId: buildings,
    propertyId: properties,
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
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))
  const chosen = recordsOf[home].find((record) => record['id'] === target)

  // The property the people to choose from are asked by.
  const propertyId =
    origin === 'defect'
      ? (defect?.place.propertyId ?? null)
      : origin === 'duty'
        ? (duty.data?.propertyId ?? null)
        : home === 'propertyId'
          ? target === ''
            ? null
            : target
          : chosen === undefined
            ? null
            : String(chosen['propertyId'])
  const candidates = useQuery({
    ...candidatesQuery(propertyId ?? ''),
    enabled: propertyId !== null,
  })

  /** A defect chosen: what the order takes from it, which can be changed after. */
  const takeDefect = (id: string) => {
    setDefectId(id)

    const picked = defects.data?.find((each) => each.id === id)

    if (picked !== undefined) {
      setPlan((before) => ({
        ...before,
        title:
          before.title === '' ? picked.description.slice(0, activityLimits.title) : before.title,
        kind: 'defect_remedy',
        dueOn: picked.dueOn ?? before.dueOn,
      }))
    }
  }

  // A duty from the address: its title, its kind and its appointment, once.
  const [tookDuty, setTookDuty] = useState(false)

  if (origin === 'duty' && duty.data !== undefined && !tookDuty) {
    setTookDuty(true)
    setPlan((before) => ({
      ...before,
      title: duty.data.title.slice(0, activityLimits.title),
      kind: activityKindOfTask(duty.data.task),
      dueOn: duty.data.appointment?.dueOn ?? today(),
    }))
  }

  // A defect from the address, once the found defects are there.
  const [tookDefect, setTookDefect] = useState(false)

  if (
    origin === 'defect' &&
    start.defectId !== undefined &&
    defects.data !== undefined &&
    !tookDefect
  ) {
    setTookDefect(true)
    takeDefect(start.defectId)
  }

  async function make() {
    const body = planBody(plan)
    const found: Record<string, string> = { ...workOrderPlanProblems(body) }

    if (origin === 'defect' && defectId === '') {
      found['origin'] = workOrderWords.noDefect
    }

    if (origin === 'duty' && start.dutyId === undefined) {
      found['origin'] = workOrderWords.dutyFromPage
    }

    if (origin === 'hand' && target === '') {
      found['target'] = workOrderWords.noPlace
    }

    setProblems(found)
    setTrouble(null)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const made = await makeAt(client, '/work-orders', {
        ...body,
        origin,
        ...(origin === 'defect' ? { defectId } : {}),
        ...(origin === 'duty' ? { dutyId: start.dutyId ?? null } : {}),
        ...(origin === 'hand' ? { [home]: target } : {}),
      })

      if (made.outcome === 'refused') {
        setTrouble(refusalFor(made))

        return
      }

      await queries.invalidateQueries({ queryKey: workOrderKey })
      await queries.invalidateQueries({ queryKey: ['defects'] })
      await queries.invalidateQueries({ queryKey: ['duties'] })
      void navigate({ to: workOrderPlaces.order(made.id) })
    } finally {
      setWorking(false)
    }
  }

  const follows =
    origin === 'defect'
      ? workOrderWords.fromDefect
      : origin === 'duty'
        ? workOrderWords.fromDuty
        : workOrderWords.byHand

  return (
    <Screen>
      <PageHead
        title="Neuer Auftrag"
        sub="Die Nummer vergibt der Server beim Speichern"
        crumbs={[workOrderListPlace]}
        phoneBack={workOrderListPlace}
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
                void make()
              }}
            >
              <Choice<WorkOrderOriginKind>
                label="Ursprung"
                value={origin}
                disabled={working}
                onChange={(value) => {
                  setOrigin(value)
                  setProblems({})
                }}
                options={workOrderOrigins.map((each) => ({
                  value: each,
                  label: workOrderOriginLabel[each],
                }))}
              />
              {origin === 'defect' ? (
                <SelectField
                  label="Mangel"
                  required
                  starred
                  value={defectId}
                  onChange={takeDefect}
                  options={[
                    {
                      value: '',
                      label: defects.data?.length === 0 ? workOrderWords.noDefects : 'Bitte wählen',
                    },
                    ...(defects.data ?? []).map((each) => ({
                      value: each.id,
                      label: [
                        each.description,
                        each.place.asset?.name ?? each.place.roomLabel ?? each.place.propertyName,
                        `festgestellt am ${date(each.foundOn)}`,
                      ]
                        .filter(Boolean)
                        .join(', '),
                    })),
                  ]}
                  {...(problems['origin'] ? { problem: problems['origin'] } : {})}
                />
              ) : null}
              {origin === 'defect' && defects.isError ? (
                <p role="alert" className="text-[13px] font-semibold text-conflict">
                  {workOrderWords.defectsFailed}
                </p>
              ) : null}
              {origin === 'duty' ? (
                start.dutyId === undefined ? (
                  <NoteBox>
                    {workOrderWords.dutyFromPage}{' '}
                    <Link to={dutyRegisterPlace.to} className={factLink}>
                      Zum Pflichtenverzeichnis
                    </Link>
                  </NoteBox>
                ) : (
                  <FactList
                    keyWidth={110}
                    facts={[
                      {
                        label: 'Pflicht',
                        value:
                          duty.data === undefined ? null : (
                            <Link to={dutyPlaces.duty(duty.data.id)} className={factLink}>
                              {duty.data.title}
                            </Link>
                          ),
                      },
                      {
                        label: 'Termin',
                        value:
                          duty.data?.appointment == null ? null : date(duty.data.appointment.dueOn),
                      },
                    ]}
                  />
                )
              ) : null}
              {origin === 'hand' ? (
                <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                  <SelectField
                    label="Woran"
                    value={home}
                    onChange={(value) => {
                      setHome(value as Home)
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
                </div>
              ) : null}
              {origin === 'defect' && defect !== undefined ? (
                <div className="flex flex-col gap-1">
                  <FactList
                    keyWidth={120}
                    facts={[
                      {
                        label: 'Ort oder Anlage',
                        value: [
                          defect.place.propertyName,
                          defect.place.buildingName,
                          defect.place.roomLabel,
                          defect.place.asset === null
                            ? null
                            : [defect.place.asset.number, defect.place.asset.name]
                                .filter(Boolean)
                                .join(' '),
                        ]
                          .filter(Boolean)
                          .join(', '),
                      },
                    ]}
                  />
                  <p className="text-[12px] text-ink-faint">{workOrderWords.takenFromDefect}</p>
                </div>
              ) : null}
              <PlanFields
                plan={plan}
                onChange={setPlan}
                people={candidates.data?.people ?? []}
                peopleFailed={candidates.isError}
                problems={problems}
                disabled={working}
                dueHint={
                  origin === 'defect' && defect?.dueOn != null
                    ? workOrderWords.defectDue
                    : origin === 'duty' && duty.data?.appointment != null
                      ? workOrderWords.appointment
                      : undefined
                }
              />
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
                void navigate({ to: workOrderListPlace.to })
              }}
            >
              Abbrechen
            </Button>
            <Button type="submit" form={formId} tone="primary" icon={Check} disabled={working}>
              Auftrag anlegen
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="Was daraus folgt">
            <div className="flex flex-col gap-2 text-[13px] leading-[1.45]">
              <p>{follows}</p>
              <p>{workOrderWords.whoFinishes}</p>
            </div>
          </Panel>
          <Panel title="Später">
            <p className="text-[12px] leading-[1.4] text-ink-muted">
              {workOrderWords.laterMaterial}
            </p>
          </Panel>
        </div>
      </div>
    </Screen>
  )
}

/**
 * "Auftrag anlegen" in the head of the file of an asset (#117), for whoever
 * plans and hands out work: a new order by hand at the asset.
 */
export function NewOrderAtAssetButton({ assetId }: { readonly assetId: string }) {
  const plans = useRight('activity.write')
  const navigate = useNavigate()

  return plans ? (
    <Button
      tone="primary"
      icon={Plus}
      onClick={() => {
        void navigate({ to: workOrderPlaces.new, search: workOrderStartSearch({ assetId }) })
      }}
    >
      Auftrag anlegen
    </Button>
  ) : null
}

/**
 * The card "Aufträge" in the file of an asset, `anlagenakte()` of the boards
 * (#117, seam from #87): the open orders at the asset, and where there is
 * none, the one accepted last. For whoever reads activities.
 */
export function AssetOrdersCard({ assetId }: { readonly assetId: string }) {
  const reads = useRight('activity.read')
  const orders = useQuery({
    queryKey: [...workOrderKey, 'asset', assetId],
    queryFn: async () => {
      const [open, accepted] = await Promise.all([
        request<WorkOrderList>(workOrderListRequest({ assetId }, '', 0, 20)),
        request<WorkOrderList>(workOrderListRequest({ assetId, state: 'accepted' }, '', 0, 1)),
      ])

      return { open: open.orders, last: accepted.orders[0] ?? null }
    },
    enabled: reads,
  })

  if (!reads) {
    return null
  }

  const open = orders.data?.open ?? []
  const last = orders.data?.last ?? null

  return (
    <Panel title="Aufträge">
      {orders.data === undefined ? (
        <p className="text-[13px] text-ink-muted">
          {orders.isError ? workOrderWords.ordersFailed : workOrderWords.pageLoading}
        </p>
      ) : open.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          {workOrderWords.noOrders}
          {last === null ? null : (
            <>
              {' Der letzte, '}
              <Link to={workOrderPlaces.order(last.id)} className={factLink}>
                {[last.number, workOrderKindLabel[last.kind]].filter(Boolean).join(' ')}
              </Link>
              {', ist abgenommen.'}
            </>
          )}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center justify-between gap-2">
              <TwoLines
                main={
                  <Link to={workOrderPlaces.order(order.id)} className={factLink}>
                    {[order.number, order.title].filter(Boolean).join(' ')}
                  </Link>
                }
                sub={[
                  workOrderKindLabel[order.kind],
                  order.dueOn === null ? null : `Frist ${date(order.dueOn)}`,
                  order.urgency === 'normal' ? null : workOrderUrgencyLabel[order.urgency],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <WorkOrderStatusMark order={order} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
