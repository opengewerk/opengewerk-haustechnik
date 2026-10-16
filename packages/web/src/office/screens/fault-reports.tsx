import {
  byNameIn,
  type FaultCategory,
  type FaultInboxFilter,
  faultInboxFilters,
  faultPlaceLine,
  faultRejectionProblems,
  faultReportLimits,
  type FaultReportEntry,
  type FaultReportPage,
  type FaultReportState,
  faultReportStateLabel,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Panel,
  Status,
  type StatusTone,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, moment } from '@opengewerk/platform-web/format'
import {
  ChangesButton,
  Chip,
  Empty,
  FactList,
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Ban, Bell, Calendar, Check, Layers, type LucideIcon, Plus } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { FaultPhoto } from '../../app/fault-photo.js'
import { askAt } from '../../sync/made-at.js'
import { useAreas } from '../../session/areas.js'
import { defectPlaces } from '../defect-addresses.js'
import { faultListPlace, faultPlaces } from '../fault-addresses.js'
import { factLink } from '../links.js'
import { officePlaces } from '../place-addresses.js'
import { RegisterFilter } from '../register-filter.js'
import { workOrderPlaces, workOrderStartSearch } from '../work-order-addresses.js'

export const faultWords = {
  sub: 'Was in Ihren Bereichen gemeldet wurde. Annehmen macht daraus einen Auftrag, Zusammenführen legt Meldungen derselben Störung zusammen.',
  received: (n: number) => (n === 1 ? '1 eingegangen' : `${String(n)} eingegangen`),
  note: 'Erledigt ist eine Meldung mit der Unterschrift unter ihrem Auftrag. Eine Meldung nennt niemanden; wer gemeldet hat, steht im Änderungsprotokoll.',
  noOrder: 'keiner',
  loading: 'Die Störungen werden geladen.',
  failed: 'Die Störungen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  noConnection: 'Ohne Verbindung zeigt das Büro keine Störungen. Sie kommen vom Server.',
  none: 'Im Eingang steht keine Meldung.',
  nothingPasses: 'Keine Meldung passt zu dieser Auswahl.',
  notThere: 'Diese Störmeldung gibt es nicht oder nicht in Ihren Bereichen.',
  pageLoading: 'Die Meldung wird geladen.',
  pageFailed: 'Die Meldung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  whatFollows:
    'Annehmen legt einen Auftrag der Art „Störung“ an, der die Meldung nennt. Erledigt ist sie mit der Unterschrift unter dem Auftrag.',
  feedback:
    'Bei Annahme und Erledigung bekommt Bescheid, wer gemeldet hat: per Push und als Stand in der eigenen Liste. Einen Grund der Ablehnung sieht die Person ebenfalls dort.',
  defect:
    'Ist die Störung ein Mangel an einer Anlage oder einem Ort, melden Sie ihn von hier. Der Mangel nennt die Meldung als Herkunft.',
  similar:
    'Am selben Ort oder im selben Gebäude und noch nicht erledigt. Ist es dieselbe Störung, führen Sie die Meldungen zusammen.',
  merged: 'Zusammengeführt mit dieser Meldung. Wer sie gemeldet hat, bekommt dieselbe Rückmeldung.',
  mergedInto: 'Diese Meldung steht unter einer anderen, deren Stand für sie gilt.',
  orderDone: 'Mit der Unterschrift unter dem Auftrag ist die Meldung erledigt.',
  mergeAbout:
    'Die Meldung kommt unter die gewählte, und deren Stand gilt dann auch für sie. Wer sie gemeldet hat, bekommt dieselbe Rückmeldung bei Annahme und Erledigung.',
  mergeWhich:
    'Zur Wahl stehen Meldungen aus demselben Gebäude, die noch nicht erledigt oder abgelehnt sind.',
  mergeNone:
    'Im selben Gebäude steht keine andere Meldung, die noch nicht erledigt oder abgelehnt ist.',
  rejectHint:
    'Den Grund sieht, wer gemeldet hat, in der eigenen Liste. Eine abgelehnte Meldung lässt sich nicht wieder öffnen.',
  photo: 'Foto der Meldung',
  noPhoto: 'Ohne Foto gemeldet.',
} as const

const stateMarks: Readonly<Record<FaultReportState, { tone: StatusTone; icon: LucideIcon }>> = {
  received: { tone: 'waiting', icon: Bell },
  accepted: { tone: 'neutral', icon: Calendar },
  done: { tone: 'done', icon: Check },
  rejected: { tone: 'locked', icon: Ban },
  merged: { tone: 'neutral', icon: Layers },
}

export function FaultStateMark({ state }: { readonly state: FaultReportState }) {
  const mark = stateMarks[state]

  return (
    <Status tone={mark.tone} icon={mark.icon}>
      {faultReportStateLabel[state]}
    </Status>
  )
}

const filterLabel: Readonly<Record<FaultInboxFilter, string>> = {
  received: 'Eingegangen',
  accepted: 'Angenommen',
  done: 'Erledigt',
  rejected: 'Abgelehnt',
  all: 'Alle',
}

/** The words of the address of the inbox, in the language of the address bar. */
const addressWords = {
  state: 'stand',
  propertyId: 'liegenschaft',
  areaId: 'bereich',
  categoryId: 'kategorie',
  buildingId: 'gebaeude',
} as const

type InboxAddress = Partial<Record<keyof typeof addressWords, string>>

function addressOf(search: Readonly<Record<string, unknown>>): InboxAddress {
  return Object.fromEntries(
    (Object.keys(addressWords) as (keyof typeof addressWords)[]).flatMap((name) => {
      const value = search[addressWords[name]]

      return typeof value === 'string' && value !== '' ? [[name, value]] : []
    }),
  )
}

function inboxRequest(address: InboxAddress, filter: FaultInboxFilter): string {
  const query = new URLSearchParams({ state: filter })

  for (const name of ['propertyId', 'areaId', 'categoryId', 'buildingId'] as const) {
    const value = address[name]

    if (value !== undefined) {
      query.set(name, value)
    }
  }

  return `/fault-reports?${query.toString()}`
}

export function faultReportQuery(id: string) {
  return {
    queryKey: ['fault-reports', 'page', id],
    queryFn: () => request<FaultReportPage>(`/fault-reports/${id}`),
    retry: (count: number, error: unknown) => !(error instanceof RequestRefused) && count < 2,
  } as const
}

/** The categories the filter offers, as reporting offers them. */
const categoriesQuery = {
  queryKey: ['fault-reports', 'categories'],
  queryFn: () => request<readonly FaultCategory[]>('/fault-reports/categories'),
} as const

function TwoLines({ main, sub }: { readonly main: ReactNode; readonly sub: ReactNode }) {
  return (
    <div className="leading-[1.32]">
      <div className="font-medium [overflow-wrap:anywhere]">{main}</div>
      <div className="text-[12px] text-ink-faint">{sub}</div>
    </div>
  )
}

/** Where a report is: its room or building, and for an asset its number and name, under the property. */
function whereOf(report: FaultReportEntry): {
  readonly name: string
  readonly sub: string
  readonly to: string
} {
  const line = faultPlaceLine(report.words)

  if (report.assetId !== null) {
    return {
      name: report.assetName ?? line,
      sub: `${report.words.property}, ${line}`,
      to: officePlaces.asset(report.assetId),
    }
  }

  return {
    name: line,
    sub: report.words.property,
    to:
      report.roomId === null
        ? officePlaces.building(report.buildingId)
        : officePlaces.room(report.roomId),
  }
}

function OrderLink({ report }: { readonly report: FaultReportEntry }) {
  return report.workOrder === null ? (
    <span className="text-ink-disabled">{faultWords.noOrder}</span>
  ) : (
    <Link to={workOrderPlaces.order(report.workOrder.activityId)} className={factLink}>
      {report.workOrder.number ?? 'Auftrag'}
    </Link>
  )
}

function FaultTable({
  reports,
  withPlace = true,
}: {
  readonly reports: readonly FaultReportEntry[]
  readonly withPlace?: boolean
}) {
  return (
    <TablePanel
      caption="Störmeldungen mit Kategorie, Ort, Eingang, Stand und Auftrag"
      note={faultWords.note}
      cards={reports.map((report) => ({
        key: report.id,
        title: (
          <Link to={faultPlaces.report(report.id)} className={cardLink}>
            {report.description}
          </Link>
        ),
        sub: [report.category, withPlace ? whereOf(report).name : null, moment(report.receivedAt)]
          .filter(Boolean)
          .join(' · '),
        right: <FaultStateMark state={report.state} />,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[200px]">Störung</Column>
          {withPlace ? <Column className="w-[300px] min-w-[180px]">Ort</Column> : null}
          <Column className="w-[150px] min-w-[130px]">Eingegangen</Column>
          <Column className="w-[150px] min-w-[130px]">Stand</Column>
          <Column className="w-[110px] min-w-[96px]">Auftrag</Column>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => {
          const where = whereOf(report)

          return (
            <tr key={report.id}>
              <Cell>
                <TwoLines
                  main={
                    <Link to={faultPlaces.report(report.id)} className={factLink}>
                      <span className="line-clamp-2">{report.description}</span>
                    </Link>
                  }
                  sub={report.category}
                />
              </Cell>
              {withPlace ? (
                <Cell>
                  <TwoLines main={<Link to={where.to}>{where.name}</Link>} sub={where.sub} />
                </Cell>
              ) : null}
              <Cell>{moment(report.receivedAt)}</Cell>
              <Cell>
                <FaultStateMark state={report.state} />
              </Cell>
              <Cell>
                <OrderLink report={report} />
              </Cell>
            </tr>
          )
        })}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Störungen", the inbox, `stoerungen()` of the boards (section 4.7 of the
 * concept, #331): what was reported in the areas of the person, the newest
 * first, narrowed by state, property, area and category. It comes from the
 * server and needs a connection.
 */
export function FaultListScreen() {
  const search = useSearch({ strict: false })
  const address = useMemo(() => addressOf(search), [search])
  const filter: FaultInboxFilter = (faultInboxFilters as readonly string[]).includes(
    address.state ?? '',
  )
    ? (address.state as FaultInboxFilter)
    : 'received'
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const areas = useAreas()
  const categories = useQuery(categoriesQuery)
  const list = useQuery({
    queryKey: ['fault-reports', 'list', filter, address],
    queryFn: () => request<readonly FaultReportEntry[]>(inboxRequest(address, filter)),
  })
  const waiting = useQuery({
    queryKey: ['fault-reports', 'list', 'received', {}],
    queryFn: () => request<readonly FaultReportEntry[]>(inboxRequest({}, 'received')),
  })
  const narrowed = Object.keys(address).some((name) => name !== 'state')

  const set = (name: keyof InboxAddress, value: string) => {
    const next: InboxAddress = { ...address, [name]: value === '' ? undefined : value }

    void navigate({
      to: faultListPlace.to,
      search: Object.fromEntries(
        (Object.keys(next) as (keyof InboxAddress)[]).flatMap((key) =>
          next[key] === undefined ? [] : [[addressWords[key], next[key]]],
        ),
      ),
      replace: true,
    })
  }
  const named = (records: readonly RecordState[]) =>
    records
      .map((record) => ({ value: String(record['id']), label: maybeText(record, 'name') ?? '' }))
      .sort((left, right) => byNameIn(left.label, right.label))

  return (
    <Screen>
      <PageHead
        title="Störungen"
        sub={faultWords.sub}
        {...(waiting.data === undefined ? {} : { count: faultWords.received(waiting.data.length) })}
      />
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div role="group" aria-label="Liste" className="flex flex-wrap gap-1.5">
          {faultInboxFilters.map((each) => (
            <Chip
              key={each}
              pressed={filter === each}
              onPress={() => {
                set('state', each === 'received' ? '' : each)
              }}
            >
              {each === 'received' && waiting.data !== undefined
                ? `${filterLabel[each]} ${String(waiting.data.length)}`
                : filterLabel[each]}
            </Chip>
          ))}
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5 max-lg:w-full">
          <RegisterFilter
            label="Liegenschaft"
            className="lg:w-[200px]"
            value={address.propertyId ?? ''}
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
              value={address.areaId ?? ''}
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
            label="Kategorie"
            className="lg:w-[190px]"
            value={address.categoryId ?? ''}
            onChange={(value) => {
              set('categoryId', value)
            }}
          >
            <option value="">Alle Kategorien</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </RegisterFilter>
        </div>
      </div>
      {list.data === undefined ? (
        <Panel>
          <Empty>
            {list.isError
              ? faultWords.failed
              : list.fetchStatus === 'paused'
                ? faultWords.noConnection
                : faultWords.loading}
          </Empty>
        </Panel>
      ) : list.data.length === 0 ? (
        <Panel>
          <Empty>
            {narrowed || filter !== 'received' ? faultWords.nothingPasses : faultWords.none}
          </Empty>
        </Panel>
      ) : (
        <FaultTable reports={list.data} />
      )}
    </Screen>
  )
}

/** The three steps of a report: received, accepted, done. */
function FaultSteps({ report }: { readonly report: FaultReportPage }) {
  const steps: readonly { readonly state: FaultReportState; readonly sub: string }[] = [
    { state: 'received', sub: moment(report.receivedAt) },
    {
      state: 'accepted',
      sub: report.acceptedAt === null ? 'wird ein Auftrag' : moment(report.acceptedAt),
    },
    { state: 'done', sub: 'mit der Unterschrift' },
  ]
  const current = report.state === 'done' ? 2 : report.state === 'accepted' ? 1 : 0

  return (
    <ol aria-label="Stand der Meldung" className="flex gap-2 max-sm:flex-col">
      {steps.map((step, index) => {
        const reached = index <= current
        const next = index === current + 1

        return (
          <li
            key={step.state}
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
                {faultReportStateLabel[step.state]}
                <span className="sr-only">{reached ? ', erreicht' : ', noch nicht'}</span>
              </div>
              <div className="text-[12px] leading-[1.35] text-ink-faint">{step.sub}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** A short list of other reports, each a link with what and where. */
function ReportLines({ reports }: { readonly reports: readonly FaultReportEntry[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {reports.map((report) => (
        <li key={report.id}>
          <TwoLines
            main={
              <Link to={faultPlaces.report(report.id)} className={factLink}>
                {report.description}
              </Link>
            }
            sub={[report.category, faultPlaceLine(report.words), moment(report.receivedAt)].join(
              ', ',
            )}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * A report, `stoerung()` of the boards (section 4.7 of the concept, #331):
 * its state, what was reported where and when, its photo, the reports of the
 * same building it may be merged with, what went into it, and the three ways
 * on: accepting it as a new work order, merging it, rejecting it. A defect is
 * reported from it once.
 */
export function FaultReportScreen() {
  const { faultReportId } = useParams({ strict: false }) as { faultReportId?: string }
  const page = useQuery({
    ...faultReportQuery(faultReportId ?? ''),
    enabled: faultReportId !== undefined,
  })
  const plans = useRight('activity.write')
  const reportsDefects = useRight('defect.report')
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'merge' | 'reject' | null>(null)
  const shown = page.data

  if (shown === undefined || faultReportId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : 'Störung'}
          crumbs={[faultListPlace]}
          phoneBack={faultListPlace}
        />
        <Empty>
          {gone
            ? faultWords.notThere
            : page.isError
              ? faultWords.pageFailed
              : faultWords.pageLoading}
        </Empty>
      </Screen>
    )
  }

  const where = whereOf(shown)
  const open = shown.state === 'received'

  return (
    <Screen>
      <PageHead
        title={`${shown.category}, ${faultPlaceLine(shown.words)}`}
        crumbs={[faultListPlace]}
        phoneBack={faultListPlace}
        badges={<FaultStateMark state={shown.state} />}
        actions={
          <>
            <ChangesButton table="fault_reports" id={shown.id} />
            {open ? (
              <>
                <Button
                  icon={Ban}
                  onClick={() => {
                    setDialog('reject')
                  }}
                >
                  Ablehnen
                </Button>
                <Button
                  icon={Layers}
                  onClick={() => {
                    setDialog('merge')
                  }}
                >
                  Zusammenführen
                </Button>
                {plans ? (
                  <Button
                    tone="primary"
                    icon={Check}
                    onClick={() => {
                      void navigate({
                        to: workOrderPlaces.new,
                        search: workOrderStartSearch({ faultReportId: shown.id }),
                      })
                    }}
                  >
                    Annehmen
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {shown.state === 'rejected' || shown.state === 'merged' ? null : (
            <Panel title="Stand">
              <FaultSteps report={shown} />
            </Panel>
          )}
          <Panel title="Meldung">
            <div className="flex flex-col gap-3">
              <p className="text-[14px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-line">
                {shown.description}
              </p>
              <FactList
                keyWidth={110}
                facts={[
                  { label: 'Kategorie', value: shown.category },
                  {
                    label: 'Ort',
                    value: (
                      <span>
                        <Link to={where.to} className={factLink}>
                          {where.name}
                        </Link>
                        {`, ${where.sub}`}
                      </span>
                    ),
                  },
                  { label: 'Eingegangen', value: moment(shown.receivedAt) },
                  ...(shown.rejectionReason === null
                    ? []
                    : [
                        {
                          label: 'Abgelehnt',
                          value: `${date(shown.rejectedAt ?? '')}: ${shown.rejectionReason}`,
                        },
                      ]),
                ]}
              />
            </div>
          </Panel>
          <Panel title="Foto">
            {shown.hasPhoto ? (
              <FaultPhoto
                path={`/fault-reports/${shown.id}/photo`}
                alt={faultWords.photo}
                className="max-h-[260px] max-w-full rounded-[4px] border border-line object-contain"
              />
            ) : (
              <p className="text-[13px] text-ink-muted">{faultWords.noPhoto}</p>
            )}
          </Panel>
          {shown.mergedInto === null ? null : (
            <Panel title="Steht unter">
              <div className="flex flex-col gap-2">
                <ReportLines reports={[shown.mergedInto]} />
                <p className="text-[12px] leading-[1.4] text-ink-muted">{faultWords.mergedInto}</p>
              </div>
            </Panel>
          )}
          {shown.merged.length === 0 ? null : (
            <Panel title="Zusammengeführt">
              <div className="flex flex-col gap-2">
                <ReportLines reports={shown.merged} />
                <p className="text-[12px] leading-[1.4] text-ink-muted">{faultWords.merged}</p>
              </div>
            </Panel>
          )}
          {open && shown.similar.length > 0 ? (
            <Panel
              title="Ähnliche Meldungen"
              action={
                <Button
                  size="small"
                  icon={Layers}
                  onClick={() => {
                    setDialog('merge')
                  }}
                >
                  Zusammenführen
                </Button>
              }
            >
              <div className="flex flex-col gap-2">
                <ReportLines reports={shown.similar} />
                <p className="text-[12px] leading-[1.4] text-ink-muted">{faultWords.similar}</p>
              </div>
            </Panel>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {shown.workOrder === null ? (
            <Panel title="Was daraus folgt">
              <div className="flex flex-col gap-2.5 text-[13px] leading-[1.5]">
                <p>{faultWords.whatFollows}</p>
                <p>{faultWords.feedback}</p>
              </div>
            </Panel>
          ) : (
            <Panel title="Auftrag daraus">
              <div className="flex flex-col gap-2">
                <TwoLines
                  main={
                    <Link
                      to={workOrderPlaces.order(shown.workOrder.activityId)}
                      className={factLink}
                    >
                      {[shown.workOrder.number, shown.workOrderTitle].filter(Boolean).join(' ')}
                    </Link>
                  }
                  sub={faultReportStateLabel[shown.state]}
                />
                <p className="text-[12px] leading-[1.4] text-ink-muted">{faultWords.orderDone}</p>
              </div>
            </Panel>
          )}
          {reportsDefects ? <DefectFromReport report={shown} /> : null}
        </div>
      </div>
      {dialog === 'merge' ? (
        <MergeDialog
          report={shown}
          onClose={() => {
            setDialog(null)
          }}
        />
      ) : null}
      {dialog === 'reject' ? (
        <RejectDialog
          report={shown}
          onClose={() => {
            setDialog(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** Keeps what a route of a report answered and the page fresh, or says why it did not. */
function useReportChange(report: FaultReportPage) {
  const client = useSync()
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function run(path: string, values: Readonly<Record<string, unknown>>): Promise<boolean> {
    setTrouble(null)
    setWorking(true)

    try {
      const result = await askAt(
        client,
        'POST',
        `/fault-reports/${report.id}/${path}`,
        report.id,
        values,
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return false
      }

      await queries.invalidateQueries({ queryKey: ['fault-reports'] })

      return true
    } finally {
      setWorking(false)
    }
  }

  return { trouble, working, run }
}

/** "Meldungen zusammenführen": one report of the same building to go under. */
function MergeDialog({
  report,
  onClose,
}: {
  readonly report: FaultReportPage
  readonly onClose: () => void
}) {
  const [into, setInto] = useState(report.similar[0]?.id ?? '')
  const { trouble, working, run } = useReportChange(report)

  return (
    <Dialog title="Meldungen zusammenführen" width={640} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void (async () => {
            if (into !== '' && (await run('merge', { intoId: into }))) {
              onClose()
            }
          })()
        }}
      >
        <p className="text-[13px] leading-[1.5]">{faultWords.mergeAbout}</p>
        {report.similar.length === 0 ? (
          <p className="text-[13px] text-ink-muted">{faultWords.mergeNone}</p>
        ) : (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium">Zusammenführen mit</legend>
            {report.similar.map((other) => (
              <label
                key={other.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-[4px] border bg-surface px-3 py-2.5 ${
                  into === other.id ? 'border-ink' : 'border-control'
                }`}
              >
                <input
                  type="radio"
                  name="fault-merge-into"
                  value={other.id}
                  checked={into === other.id}
                  onChange={() => {
                    setInto(other.id)
                  }}
                  className="mt-0.5"
                />
                <span className="text-[14px]">
                  {other.description}
                  <span className="block text-[13px] text-ink-muted">
                    {[
                      other.category,
                      faultPlaceLine(other.words),
                      moment(other.receivedAt),
                      faultReportStateLabel[other.state].toLowerCase(),
                    ].join(', ')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <p className="text-[12px] text-ink-muted">{faultWords.mergeWhich}</p>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Layers} disabled={working || into === ''}>
            {working ? 'Einen Moment' : 'Zusammenführen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** "Meldung ablehnen?": the reason, which the person who reported reads. */
function RejectDialog({
  report,
  onClose,
}: {
  readonly report: FaultReportPage
  readonly onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const { trouble, working, run } = useReportChange(report)

  return (
    <Dialog title="Meldung ablehnen?" width={520} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()

          const wrong = faultRejectionProblems({ reason })['reason']

          setProblem(wrong)

          if (wrong !== undefined) {
            return
          }

          void (async () => {
            if (await run('reject', { reason: reason.trim() })) {
              onClose()
            }
          })()
        }}
      >
        <TextArea
          label="Grund"
          rows={3}
          required
          starred
          maxLength={faultReportLimits.reason}
          value={reason}
          hint={faultWords.rejectHint}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="danger" icon={Ban} disabled={working}>
            {working ? 'Einen Moment' : 'Ablehnen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** "Mangel": a defect reported from the report, once, which then opens. */
function DefectFromReport({ report }: { readonly report: FaultReportPage }) {
  const { trouble, working, run } = useReportChange(report)
  const navigate = useNavigate()
  const client = useSync()

  if (report.defectId !== null) {
    return (
      <Panel title="Mangel">
        <Link to={defectPlaces.defect(report.defectId)} className={factLink}>
          Den gemeldeten Mangel öffnen
        </Link>
      </Panel>
    )
  }

  return (
    <Panel title="Mangel">
      <div className="flex flex-col gap-2">
        <p className="text-[12px] leading-[1.4] text-ink-muted">{faultWords.defect}</p>
        <div>
          <Button
            size="small"
            icon={Plus}
            disabled={working}
            onClick={() => {
              void (async () => {
                if (await run('defect', {})) {
                  const fresh = await request<FaultReportPage>(`/fault-reports/${report.id}`)

                  void client.synchronise()

                  if (fresh.defectId !== null) {
                    void navigate({ to: defectPlaces.defect(fresh.defectId) })
                  }
                }
              })()
            }}
          >
            Mangel melden
          </Button>
        </div>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
      </div>
    </Panel>
  )
}

/**
 * "Störungen" in the file of an asset (#331, #87): the open reports at it,
 * otherwise the last one that is done. Only for whoever accepts faults.
 */
export function AssetFaultsCard({ assetId }: { readonly assetId: string }) {
  const reads = useRight('fault.accept')
  const reports = useQuery({
    queryKey: ['fault-reports', 'asset', assetId],
    queryFn: () =>
      request<readonly FaultReportEntry[]>(
        `/fault-reports?state=all&assetId=${encodeURIComponent(assetId)}`,
      ),
    enabled: reads,
  })

  if (!reads) {
    return null
  }

  const all = reports.data ?? []
  const open = all.filter((report) => report.state === 'received' || report.state === 'accepted')
  const last = all.find((report) => report.state === 'done')

  return (
    <Panel title="Störungen">
      {reports.data === undefined ? (
        <p className="text-[13px] text-ink-muted">
          {reports.isError ? faultWords.failed : faultWords.loading}
        </p>
      ) : open.length > 0 ? (
        <FaultTableLines reports={open} />
      ) : (
        <p className="text-[13px] leading-[1.45] text-ink-muted">
          {last === undefined ? (
            'Keine Störung gemeldet.'
          ) : (
            <>
              {'Keine offene Störung. Die letzte, '}
              <Link to={faultPlaces.report(last.id)} className={factLink}>
                {last.description}
              </Link>
              {', ist erledigt.'}
            </>
          )}
        </p>
      )}
    </Panel>
  )
}

function FaultTableLines({ reports }: { readonly reports: readonly FaultReportEntry[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {reports.map((report) => (
        <li key={report.id} className="flex items-start justify-between gap-3">
          <TwoLines
            main={
              <Link to={faultPlaces.report(report.id)} className={factLink}>
                {report.description}
              </Link>
            }
            sub={`${report.category}, ${moment(report.receivedAt)}`}
          />
          <FaultStateMark state={report.state} />
        </li>
      ))}
    </ul>
  )
}
