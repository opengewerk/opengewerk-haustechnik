import {
  addMonths,
  type Consumption,
  type IsoDate,
  keyDateFor,
  type MeterDetails,
  type MeterEntry,
  meterFigure,
  meterLimits,
  type MeterList,
  type MeterListState,
  meterMedia,
  meterMediumLabel,
  meterReadingSourceLabel,
  type MeterRow,
  type MeterState,
  meterStateLabel,
  meterUnitSymbol,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Field,
  NumberBadge,
  Panel,
  SelectField,
  Status,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, scaledNumber, today } from '@opengewerk/platform-web/format'
import { Chip, Empty, FactList, NoteBox, PageHead, Screen } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeftRight, Check, Gauge, Lock, Pause, Plus } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { placePath } from '../../app/place-path.js'
import { placeAbove } from '../../app/place-records.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt } from '../../sync/made-at.js'
import { assetForms } from '../asset-addresses.js'
import { factLink } from '../links.js'
import { meterListPlace, meterListWords, meterPlaces } from '../meter-addresses.js'
import { officePlaces } from '../place-addresses.js'
import { RegisterFilter } from '../register-filter.js'
import { kindLabel } from './assets.js'

export const meterWords = {
  title: 'Zähler',
  newMeter: 'Neue Messstelle',
  meter: 'Messstelle',
  medium: 'Medium',
  unit: 'Einheit',
  meterNumber: 'Zählernummer',
  lastReading: 'Letzter Stand',
  atKeyDate: 'Stand zum Stichtag',
  keyDate: 'Stichtag',
  property: 'Liegenschaft',
  allProperties: 'Alle Liegenschaften',
  allMedia: 'Alle',
  all: 'Alle',
  missingCount: (count: number) => `Stand fehlt ${String(count)}`,
  pausedCount: (count: number) => `Stillgelegt ${String(count)}`,
  lockedCount: (count: number) => `Gesperrt ${String(count)}`,
  count: (meters: number, properties: number) =>
    meters === 0
      ? 'Keine Messstelle'
      : `${meters.toLocaleString('de-DE')} ${meters === 1 ? 'Messstelle' : 'Messstellen'} in ${properties.toLocaleString('de-DE')} ${properties === 1 ? 'Liegenschaft' : 'Liegenschaften'}`,
  listNote:
    'Der Verbrauch wird aus den Ständen abgeleitet und nie gespeichert. Ein Unterzähler steht unter seinem Hauptzähler.',
  none: 'Noch keine Messstelle. Ein Zähler ist eine Anlage mit Zählernummer.',
  nothingPasses: 'Keine Messstelle passt zu dieser Auswahl.',
  loading: 'Die Zähler werden geladen.',
  failed: 'Die Zähler ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  noConnection: 'Ohne Verbindung sind die Zähler nicht zu sehen.',
  notThere: 'Diese Messstelle gibt es nicht oder nicht mehr.',
  pageLoading: 'Die Messstelle wird geladen.',
  pageFailed: 'Die Messstelle ließ sich nicht laden.',
  exchange: 'Zählertausch',
  pause: 'Stilllegen',
  lock: 'Sperren',
  unlock: 'Sperre aufheben',
  enter: 'Stand eintragen',
  standAt: (keyDate: IsoDate) => `Stand zum ${date(keyDate)}`,
  readOn: 'Abgelesen am',
  cancel: 'Abbrechen',
  save: 'Speichern',
  wait: 'Einen Moment',
  readings: 'Stände',
  stand: 'Stand',
  consumption: 'Verbrauch',
  read: 'Abgelesen',
  way: 'Weg',
  correct: 'Berichtigen',
  missing: 'fehlt',
  none_: 'keiner',
  paused: 'stillgelegt',
  first: 'erster Stand',
  over: (months: number) => `über ${String(months)} Monate`,
  corrected: (name: string, reason: string, before: string) =>
    `berichtigt von ${name}: ${reason}, vorher ${before}`,
  readingsNote:
    'Verbrauch bis zum Stichtag, abgeleitet aus zwei Ständen und nie gespeichert. Eine Zeit, die ganz in einer Stilllegung liegt, hat keinen; über einen Zählertausch rechnet er über beide Zähler.',
  history: 'Verlauf',
  twelve: '12 Monate',
  twentyFour: '24 Monate',
  untilKeyDate: 'Bis Stichtag',
  previousYear: 'Vorjahr',
  change: 'Veränderung',
  historyNote:
    'Je Stichtag der Verbrauch seit dem Stand davor und derselbe Stichtag ein Jahr früher.',
  nothing: '—',
  edit: 'Bearbeiten',
  factor: 'Wandlerfaktor',
  mainMeter: 'Hauptzähler',
  subMeters: 'Unterzähler',
  controlId: 'Kennung in der Leittechnik',
  kind: 'Anlagenart',
  note: 'Notiz',
  noNote: 'Noch keine Notiz.',
  changeNote: 'Ändern',
  noteSince: (on: IsoDate, name: string) => `Notiz, seit ${date(on)}, ${name}`,
  restAndLock: 'Stilllegung und Sperre',
  since: (on: IsoDate) => `seit ${date(on)}`,
  period: (from: IsoDate, to: IsoDate) =>
    `${from.slice(0, 4) === to.slice(0, 4) ? date(from).slice(0, 6) : date(from)} bis ${date(to)}`,
  pausedFor: (reason: string) => `Stillgelegt: ${reason}`,
  noLock:
    'Keine Sperre. Eine Sperre nennt ihren Grund und hält die Ablesung an, bis sie aufgehoben ist.',
  lockedSince: (on: IsoDate) => `Gesperrt seit ${date(on)}`,
  lockedBanner: (on: IsoDate, reason: string) =>
    `Gesperrt seit ${date(on)}: ${reason} Ein Stand wird eingetragen, wenn die Sperre aufgehoben ist.`,
  end: 'Beenden',
  noPause: 'Keine Stilllegung.',
  aFigure: 'Eine Zahl, etwa 4.801,2.',
  ofRows: (shown: number, all: number) =>
    `${shown.toLocaleString('de-DE')} von ${all.toLocaleString('de-DE')}`,
  more: 'Weitere laden',
} as const

/** How many key dates the readings show at first, and how many more each time. */
const firstRows = 6
const moreRows = 12

/** The meters in the cache: every list and every page. */
const meterKey = ['meters'] as const

function meterQuery(id: string) {
  return {
    queryKey: [...meterKey, 'page', id],
    queryFn: () => request<MeterDetails>(`/meters/${id}`),
  } as const
}

/** The key date of this month. */
function currentKeyDate(): IsoDate {
  return `${today().slice(0, 7)}-01` as IsoDate
}

/** What an address says after a word, as text. */
function said(search: Readonly<Record<string, unknown>>, word: string): string | undefined {
  const value = search[word]

  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** How a measuring point stands for a key date, `status()` of the boards. */
export function MeterStateMark({ state }: { readonly state: MeterState }) {
  switch (state) {
    case 'present':
      return <Status tone="done">{meterStateLabel.present}</Status>
    case 'paused':
      return (
        <Status tone="neutral" icon={Pause}>
          {meterStateLabel.paused}
        </Status>
      )
    case 'locked':
      return (
        <Status tone="waiting" icon={Lock}>
          {meterStateLabel.locked}
        </Status>
      )
    default:
      return <span className="font-semibold text-conflict">{meterStateLabel.missing}</span>
  }
}

/** A measuring point in words: its mark and its name. */
function titleOf(meter: Pick<MeterEntry, 'mark' | 'name'>): string {
  return [meter.mark, meter.name].filter(Boolean).join(' ')
}

/** Where a measuring point is, in a line: the property, the building and the room. */
function usePlaceLine(): (meter: MeterEntry) => string {
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  return useMemo(() => {
    const byId = (records: readonly RecordState[], id: string | null) =>
      id === null ? null : (records.find((record) => record['id'] === id) ?? null)

    return (meter: MeterEntry) =>
      [
        maybeText(byId(properties, meter.propertyId), 'name'),
        maybeText(byId(buildings, meter.buildingId), 'name'),
        maybeText(byId(rooms, meter.roomId), 'number'),
      ]
        .filter(Boolean)
        .join(', ')
  }, [properties, buildings, rooms])
}

/** Two lines in a cell: the thing, and what it is or where. */
function TwoLines({
  main,
  sub,
  bold = false,
}: {
  readonly main: ReactNode
  readonly sub?: ReactNode
  readonly bold?: boolean
}) {
  return (
    <span className="flex min-w-0 flex-col leading-[1.3]">
      <span className={bold ? 'font-semibold' : undefined}>{main}</span>
      {sub === undefined || sub === '' || sub === null ? null : (
        <span className="text-[12px] text-ink-faint">{sub}</span>
      )}
    </span>
  )
}

/** The measuring points with each sub meter under its main meter, as far as both are listed. */
function nested(
  meters: readonly MeterEntry[],
): { readonly meter: MeterEntry; readonly sub: boolean }[] {
  const listed = new Set(meters.map((meter) => meter.assetId))
  const top = meters.filter((meter) => meter.mainMeterId === null || !listed.has(meter.mainMeterId))
  const below = (main: MeterEntry) => meters.filter((meter) => meter.mainMeterId === main.assetId)

  return top.flatMap((meter) => [
    { meter, sub: false },
    ...below(meter).map((each) => ({ meter: each, sub: true })),
  ])
}

/**
 * "Zähler" in the office, the board "Zähler, Stand zum Stichtag (4.9)"
 * (#119): every measuring point the person sees, with its last reading and
 * how it stands for a key date, a sub meter under its main meter, narrowed
 * by state, property and medium. The list comes from the server.
 */
export function MeterListScreen() {
  const address = useSearch({ strict: false })
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const placeLine = usePlaceLine()
  const writes = useRight('asset.write')
  const state = (said(address, meterListWords.state) ?? 'all') as MeterListState
  const property = said(address, meterListWords.property) ?? ''
  const medium = said(address, meterListWords.medium) ?? ''
  const keyDate = (said(address, meterListWords.keyDate) ?? currentKeyDate()) as IsoDate
  const parts = new URLSearchParams({
    keyDate,
    ...(state === 'all' ? {} : { state }),
    ...(property === '' ? {} : { property }),
    ...(medium === '' ? {} : { medium }),
  })
  const list = useQuery({
    queryKey: [...meterKey, 'list', parts.toString()],
    queryFn: () => request<MeterList>(`/meters?${parts.toString()}`),
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const keyDates = Array.from({ length: 13 }, (_, months) => addMonths(currentKeyDate(), -months))

  /** The address with one part set, or without it for "all". */
  const set = (word: string, value: string) => {
    const { [word]: _, ...rest } = address as Readonly<Record<string, unknown>>

    void navigate({
      to: meterListPlace.to,
      search: value === '' ? rest : { ...rest, [word]: value },
      replace: true,
    })
  }
  const shown = list.data

  return (
    <Screen>
      <PageHead
        title={meterWords.title}
        {...(shown === undefined ? {} : { count: meterWords.count(shown.total, shown.properties) })}
        actions={
          writes ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                void navigate({ to: assetForms.new })
              }}
            >
              {meterWords.newMeter}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div role="group" aria-label="Stand" className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', meterWords.all],
              ['missing', meterWords.missingCount(shown?.counts.missing ?? 0)],
              ['paused', meterWords.pausedCount(shown?.counts.paused ?? 0)],
              ['locked', meterWords.lockedCount(shown?.counts.locked ?? 0)],
            ] as const
          ).map(([each, label]) => (
            <Chip
              key={each}
              pressed={state === each}
              onPress={() => {
                set(meterListWords.state, each === 'all' ? '' : each)
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5 max-lg:w-full">
          <RegisterFilter
            label={meterWords.property}
            className="lg:w-[200px]"
            value={property}
            onChange={(value) => {
              set(meterListWords.property, value)
            }}
          >
            <option value="">{meterWords.allProperties}</option>
            {[...properties]
              .filter((each) => each['deletedAt'] === null || each['deletedAt'] === undefined)
              .sort((left, right) =>
                String(left['name']).localeCompare(String(right['name']), 'de'),
              )
              .map((each) => (
                <option key={String(each['id'])} value={String(each['id'])}>
                  {String(each['name'])}
                </option>
              ))}
          </RegisterFilter>
          <RegisterFilter
            label={meterWords.medium}
            className="lg:w-[130px]"
            value={medium}
            onChange={(value) => {
              set(meterListWords.medium, value)
            }}
          >
            <option value="">{meterWords.allMedia}</option>
            {meterMedia.map((each) => (
              <option key={each} value={each}>
                {meterMediumLabel[each]}
              </option>
            ))}
          </RegisterFilter>
          <RegisterFilter
            label={meterWords.keyDate}
            className="lg:w-[130px]"
            value={keyDate}
            onChange={(value) => {
              set(meterListWords.keyDate, value === currentKeyDate() ? '' : value)
            }}
          >
            {keyDates.map((each) => (
              <option key={each} value={each}>
                {date(each)}
              </option>
            ))}
          </RegisterFilter>
        </div>
      </div>
      {shown === undefined ? (
        <Panel>
          <Empty>
            {list.isError
              ? meterWords.failed
              : list.fetchStatus === 'paused'
                ? meterWords.noConnection
                : meterWords.loading}
          </Empty>
        </Panel>
      ) : shown.meters.length === 0 ? (
        <Panel>
          <Empty>
            {state !== 'all' || property !== '' || medium !== ''
              ? meterWords.nothingPasses
              : meterWords.none}
          </Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Messstellen mit Medium, Einheit, Zählernummer, letztem Stand und dem Stand zum Stichtag"
          note={meterWords.listNote}
          cards={nested(shown.meters).map(({ meter }) => ({
            key: meter.assetId,
            title: (
              <Link to={meterPlaces.meter(meter.assetId)} className={cardLink}>
                {titleOf(meter)}
              </Link>
            ),
            sub: [
              placeLine(meter),
              meter.lastReading === null
                ? null
                : meterFigure(meter.lastReading.valueMilli, meter.unit),
            ]
              .filter(Boolean)
              .join(' · '),
            right: <MeterStateMark state={meter.state} />,
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[220px]">{meterWords.meter}</Column>
              <Column className="w-[96px] min-w-[90px]">{meterWords.medium}</Column>
              <Column className="w-[70px] min-w-[64px]">{meterWords.unit}</Column>
              <Column className="w-[140px] min-w-[120px]">{meterWords.meterNumber}</Column>
              <Column className="w-[130px] min-w-[120px]">{meterWords.lastReading}</Column>
              <Column className="w-[150px] min-w-[140px]">{meterWords.atKeyDate}</Column>
            </tr>
          </thead>
          <tbody>
            {nested(shown.meters).map(({ meter, sub }) => (
              <tr key={meter.assetId}>
                <Cell>
                  <span className={sub ? 'flex gap-1 pl-3.5' : 'flex'}>
                    {sub ? (
                      <span aria-hidden="true" className="text-ink-faint">
                        └
                      </span>
                    ) : null}
                    <TwoLines
                      bold
                      main={<Link to={meterPlaces.meter(meter.assetId)}>{titleOf(meter)}</Link>}
                      sub={placeLine(meter)}
                    />
                  </span>
                </Cell>
                <Cell>
                  {meter.medium === null ? meterWords.nothing : meterMediumLabel[meter.medium]}
                </Cell>
                <Cell>{meterUnitSymbol[meter.unit]}</Cell>
                <Cell>
                  <span className="text-ink-muted">{meter.meterNumber}</span>
                </Cell>
                <Cell>
                  {meter.lastReading === null ? (
                    <span className="text-ink-faint">{meterWords.nothing}</span>
                  ) : (
                    <TwoLines
                      bold
                      main={meterFigure(meter.lastReading.valueMilli, meter.unit)}
                      sub={date(meter.lastReading.readOn)}
                    />
                  )}
                </Cell>
                <Cell>
                  <MeterStateMark state={meter.state} />
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

/** Which dialog of the page of a measuring point is open. */
type MeterDialog =
  | { readonly kind: 'exchange' }
  | { readonly kind: 'pause' }
  | {
      readonly kind: 'endPause'
      readonly pauseId: string
      readonly startsOn: IsoDate
      readonly reason: string
    }
  | { readonly kind: 'lock' }
  | { readonly kind: 'correct'; readonly row: MeterRow }
  | { readonly kind: 'edit' }
  | { readonly kind: 'note' }

/**
 * The page of a measuring point, the board "Messstelle mit Ständen und
 * Verbrauch (4.9)" (#119): its readings with the consumption up to each key
 * date, its history beside the year before, what only it carries, its note,
 * the periods it rests and its lock. A reading is entered by whoever reads
 * meters, and corrected by a new one; the rest is for whoever takes care of
 * assets. Locked, it takes no reading until the lock is lifted.
 */
export function MeterScreen() {
  const { meterId } = useParams({ strict: false }) as { meterId?: string }
  const page = useQuery({ ...meterQuery(meterId ?? ''), enabled: meterId !== undefined })
  const shown = page.data
  const client = useSync()
  const queries = useQueryClient()
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  const reads = useRight('reading.write')
  const writes = useRight('asset.write')
  const [entering, setEntering] = useState(false)
  const [dialog, setDialog] = useState<MeterDialog | null>(null)
  const [months, setMonths] = useState<12 | 24>(12)
  const [rowCount, setRowCount] = useState(firstRows)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (shown === undefined || meterId === undefined) {
    const gone = page.error instanceof RequestRefused && page.error.status === 404

    return (
      <Screen>
        <PageHead
          title={gone ? 'Nicht gefunden' : meterWords.meter}
          crumbs={[meterListPlace]}
          phoneBack={meterListPlace}
        />
        <Empty>
          {gone
            ? meterWords.notThere
            : page.isError
              ? meterWords.pageFailed
              : page.fetchStatus === 'paused'
                ? meterWords.noConnection
                : meterWords.pageLoading}
        </Empty>
      </Screen>
    )
  }

  const byId = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : (records.find((record) => record['id'] === id) ?? null)
  const property = byId(properties, shown.propertyId)
  const building = byId(buildings, shown.buildingId)
  const room = byId(rooms, shown.roomId)
  const locked = shown.lock !== null
  const figure = (milli: number) => meterFigure(milli, shown.unit)
  const rows = shown.rows.slice(0, rowCount)
  const done = async () => {
    await queries.invalidateQueries({ queryKey: meterKey })
    setDialog(null)
    setEntering(false)
  }

  async function unlock() {
    setTrouble(null)

    const result = await askAt(
      client,
      'DELETE',
      `/meters/${shown?.assetId ?? ''}/lock`,
      shown?.assetId ?? '',
    )

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await done()
  }

  return (
    <Screen>
      <PageHead
        title={shown.name}
        crumbs={
          property
            ? placePath(placeAbove({ property, building, room }), officePlaces)
            : [meterListPlace]
        }
        phoneBack={meterListPlace}
        {...(shown.mark === null ? {} : { badges: <NumberBadge>{shown.mark}</NumberBadge> })}
        tags={
          <>
            <Status tone="neutral" icon={Gauge}>
              {[
                shown.medium === null ? null : meterMediumLabel[shown.medium],
                meterUnitSymbol[shown.unit],
              ]
                .filter(Boolean)
                .join(', ')}
            </Status>
            {locked ? (
              <Status tone="waiting" icon={Lock}>
                {meterStateLabel.locked}
              </Status>
            ) : null}
          </>
        }
        actions={
          <>
            {writes ? (
              <Button
                icon={ArrowLeftRight}
                onClick={() => {
                  setDialog({ kind: 'exchange' })
                }}
              >
                {meterWords.exchange}
              </Button>
            ) : null}
            {writes ? (
              <Button
                icon={Pause}
                onClick={() => {
                  setDialog({ kind: 'pause' })
                }}
              >
                {meterWords.pause}
              </Button>
            ) : null}
            {writes ? (
              <Button
                icon={Lock}
                onClick={() => {
                  if (locked) {
                    void unlock()
                  } else {
                    setDialog({ kind: 'lock' })
                  }
                }}
              >
                {locked ? meterWords.unlock : meterWords.lock}
              </Button>
            ) : null}
            {reads ? (
              <Button
                tone="primary"
                icon={Plus}
                disabled={locked}
                onClick={() => {
                  setEntering(true)
                }}
              >
                {meterWords.enter}
              </Button>
            ) : null}
          </>
        }
      />
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {locked && shown.lock !== null ? (
            <NoteBox tone="waiting" icon={Lock}>
              {meterWords.lockedBanner(shown.lock.on, shown.lock.reason)}
            </NoteBox>
          ) : entering ? (
            <ReadingCard
              meter={shown}
              onCancel={() => {
                setEntering(false)
              }}
              onDone={done}
            />
          ) : null}
          <TablePanel
            title={meterWords.readings}
            caption="Stände je Stichtag mit Verbrauch, wann und von wem abgelesen und auf welchem Weg"
            note={meterWords.readingsNote}
            {...(shown.rows.length > rows.length
              ? {
                  footer: (
                    <>
                      <span>{meterWords.ofRows(rows.length, shown.rows.length)}</span>
                      <span className="grow" />
                      <Button
                        size="small"
                        onClick={() => {
                          setRowCount((count) => count + moreRows)
                        }}
                      >
                        {meterWords.more}
                      </Button>
                    </>
                  ),
                }
              : {})}
            cards={rows.map((row) => ({
              key: row.keyDate,
              title: date(row.keyDate),
              sub: [standWords(row, figure), consumptionWords(row.consumption, figure, row)]
                .filter(Boolean)
                .join(' · '),
              right:
                reads && row.reading !== null ? (
                  <CorrectButton
                    onPress={() => {
                      setDialog({ kind: 'correct', row })
                    }}
                  />
                ) : null,
            }))}
          >
            <thead>
              <tr>
                <Column className="w-[90px]">{meterWords.keyDate}</Column>
                <Column className="w-[110px] text-right">{meterWords.stand}</Column>
                <Column className="w-[110px] text-right">{meterWords.consumption}</Column>
                <Column>{meterWords.read}</Column>
                <Column className="w-[110px]">{meterWords.way}</Column>
                <Column className="w-[84px]">
                  <span className="sr-only">{meterWords.correct}</span>
                </Column>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const original = row.corrected[row.corrected.length - 1] ?? row.reading

                return (
                  <tr key={row.keyDate}>
                    <Cell>
                      <span className={index === 0 ? 'font-semibold' : undefined}>
                        {date(row.keyDate)}
                      </span>
                    </Cell>
                    <Cell className="text-right">
                      <StandCell row={row} figure={figure} />
                    </Cell>
                    <Cell className="text-right">
                      <ConsumptionCell row={row} figure={figure} />
                    </Cell>
                    <Cell>
                      {row.reading === null || original === null ? null : (
                        <TwoLines
                          main={`${date(original.readOn)}, ${original.name}`}
                          sub={
                            row.corrected.length === 0 || row.reading.correctionReason === null
                              ? undefined
                              : meterWords.corrected(
                                  row.reading.name,
                                  row.reading.correctionReason,
                                  figure(original.valueMilli),
                                )
                          }
                        />
                      )}
                    </Cell>
                    <Cell>
                      {original === null ? null : meterReadingSourceLabel[original.source]}
                    </Cell>
                    <Cell className="text-right">
                      {reads && row.reading !== null ? (
                        <CorrectButton
                          onPress={() => {
                            setDialog({ kind: 'correct', row })
                          }}
                        />
                      ) : null}
                    </Cell>
                  </tr>
                )
              })}
            </tbody>
          </TablePanel>
          <HistoryPanel meter={shown} months={months} onMonths={setMonths} figure={figure} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel
            title={meterWords.meter}
            action={
              writes ? (
                <Button
                  size="small"
                  onClick={() => {
                    setDialog({ kind: 'edit' })
                  }}
                >
                  {meterWords.edit}
                </Button>
              ) : undefined
            }
          >
            <FactList
              keyWidth={100}
              facts={[
                {
                  label: meterWords.medium,
                  value: shown.medium === null ? null : meterMediumLabel[shown.medium],
                },
                { label: meterWords.unit, value: meterUnitSymbol[shown.unit] },
                { label: meterWords.meterNumber, value: shown.meterNumber },
                { label: meterWords.factor, value: String(shown.conversionFactor ?? 1) },
                ...(shown.mainMeter === null
                  ? []
                  : [
                      {
                        label: meterWords.mainMeter,
                        value: (
                          <Link
                            to={meterPlaces.meter(shown.mainMeter.assetId)}
                            className={factLink}
                          >
                            {titleOf(shown.mainMeter)}
                          </Link>
                        ),
                      },
                    ]),
                ...(shown.subMeters.length === 0
                  ? []
                  : [
                      {
                        label: meterWords.subMeters,
                        value: (
                          <span className="flex flex-col">
                            {shown.subMeters.map((each) => (
                              <Link
                                key={each.assetId}
                                to={meterPlaces.meter(each.assetId)}
                                className={factLink}
                              >
                                {titleOf(each)}
                              </Link>
                            ))}
                          </span>
                        ),
                      },
                    ]),
                ...(shown.controlId === null
                  ? []
                  : [{ label: meterWords.controlId, value: shown.controlId }]),
                { label: meterWords.kind, value: kindLabel(catalogue, shown.kind) },
              ]}
            />
          </Panel>
          <Panel
            title={meterWords.note}
            action={
              writes ? (
                <Button
                  size="small"
                  onClick={() => {
                    setDialog({ kind: 'note' })
                  }}
                >
                  {meterWords.changeNote}
                </Button>
              ) : undefined
            }
          >
            {shown.note === null ? (
              <p className="text-[13px] text-ink-muted">{meterWords.noNote}</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-[13px] leading-[1.45] whitespace-pre-line">{shown.note.text}</p>
                <p className="text-[12px] text-ink-muted">
                  {meterWords.noteSince(shown.note.on, shown.note.name)}
                </p>
              </div>
            )}
          </Panel>
          <Panel title={meterWords.restAndLock}>
            <div className="flex flex-col gap-2">
              {shown.pauses.length === 0 ? (
                <p className="text-[12px] text-ink-muted">{meterWords.noPause}</p>
              ) : (
                <ul className="flex flex-col gap-2" aria-label="Stilllegungen">
                  {shown.pauses.map((pause) => (
                    <li key={pause.id} className="flex items-start gap-2">
                      <TwoLines
                        bold
                        main={
                          pause.endsOn === null
                            ? meterWords.since(pause.startsOn)
                            : meterWords.period(pause.startsOn, pause.endsOn)
                        }
                        sub={meterWords.pausedFor(pause.reason)}
                      />
                      <span className="grow" />
                      {writes && pause.endsOn === null ? (
                        <Button
                          size="small"
                          onClick={() => {
                            setDialog({
                              kind: 'endPause',
                              pauseId: pause.id,
                              startsOn: pause.startsOn,
                              reason: pause.reason,
                            })
                          }}
                        >
                          {meterWords.end}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {shown.lock === null ? (
                <p className="text-[12px] leading-[1.4] text-ink-muted">{meterWords.noLock}</p>
              ) : (
                <TwoLines
                  bold
                  main={meterWords.lockedSince(shown.lock.on)}
                  sub={shown.lock.reason}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
      {dialog === null ? null : (
        <MeterDialogs
          meter={shown}
          dialog={dialog}
          figure={figure}
          onClose={() => {
            setDialog(null)
          }}
          onDone={done}
        />
      )}
    </Screen>
  )
}

/** The button that corrects the reading of a key date. */
function CorrectButton({ onPress }: { readonly onPress: () => void }) {
  return (
    <button type="button" className={`${factLink} text-[13px]`} onClick={onPress}>
      {meterWords.correct}
    </button>
  )
}

/** The reading of a key date, or why there is none. */
function standWords(row: MeterRow, figure: (milli: number) => string): string {
  return row.reading !== null
    ? figure(row.reading.valueMilli)
    : row.state === 'paused'
      ? meterWords.paused
      : row.state === 'missing' || row.state === 'locked'
        ? meterWords.missing
        : meterWords.nothing
}

function StandCell({
  row,
  figure,
}: {
  readonly row: MeterRow
  readonly figure: (milli: number) => string
}) {
  if (row.reading !== null) {
    return <>{figure(row.reading.valueMilli)}</>
  }

  return row.state === 'missing' || row.state === 'locked' ? (
    <span className="font-semibold text-conflict">{meterWords.missing}</span>
  ) : (
    <span className="text-ink-faint">{standWords(row, figure)}</span>
  )
}

/** The consumption up to a key date in words. */
function consumptionWords(
  consumption: Consumption | null,
  figure: (milli: number) => string,
  row?: Pick<MeterRow, 'state' | 'reading'>,
): string {
  if (consumption === null) {
    return row?.reading === null && row.state === 'paused' ? meterWords.paused : meterWords.none_
  }

  switch (consumption.kind) {
    case 'consumed':
      return consumption.months > 1
        ? `${figure(consumption.milli)}, ${meterWords.over(consumption.months)}`
        : figure(consumption.milli)
    case 'paused':
      return meterWords.paused
    default:
      return meterWords.first
  }
}

function ConsumptionCell({
  row,
  figure,
}: {
  readonly row: MeterRow
  readonly figure: (milli: number) => string
}) {
  const words = consumptionWords(row.consumption, figure, row)

  return row.consumption?.kind === 'consumed' ? (
    <>{words}</>
  ) : (
    <span className="text-ink-faint">{words}</span>
  )
}

/** The consumption up to the same key date a year before, against this one. */
function changeWords(now: Consumption | null, before: Consumption | null): string {
  if (
    now?.kind !== 'consumed' ||
    before?.kind !== 'consumed' ||
    now.months !== before.months ||
    before.milli === 0
  ) {
    return ''
  }

  const percent = Math.round(((now.milli - before.milli) / before.milli) * 100)

  return `${percent > 0 ? '+' : percent < 0 ? '−' : '±'}${String(Math.abs(percent))} %`
}

/** The history of a measuring point over twelve or 24 key dates, beside the year before. */
function HistoryPanel({
  meter,
  months,
  onMonths,
  figure,
}: {
  readonly meter: MeterDetails
  readonly months: 12 | 24
  readonly onMonths: (months: 12 | 24) => void
  readonly figure: (milli: number) => string
}) {
  const since = meter.rows[meter.rows.length - 1]?.keyDate
  const lines = meter.history
    .slice(0, months)
    .filter((line) => since !== undefined && line.keyDate >= since)
  const rowOf = (keyDate: IsoDate) => meter.rows.find((row) => row.keyDate === keyDate)
  const said_ = (consumption: Consumption | null, keyDate?: IsoDate) => {
    if (consumption !== null) {
      return consumptionWords(consumption, figure)
    }

    const row = keyDate === undefined ? undefined : rowOf(keyDate)

    return row?.state === 'missing' || row?.state === 'locked'
      ? meterWords.missing
      : row?.state === 'paused'
        ? meterWords.paused
        : meterWords.nothing
  }

  return (
    <TablePanel
      title={meterWords.history}
      action={
        <div role="group" aria-label="Zeitraum" className="flex gap-1.5">
          <Chip
            pressed={months === 12}
            onPress={() => {
              onMonths(12)
            }}
          >
            {meterWords.twelve}
          </Chip>
          <Chip
            pressed={months === 24}
            onPress={() => {
              onMonths(24)
            }}
          >
            {meterWords.twentyFour}
          </Chip>
        </div>
      }
      caption="Verbrauch je Stichtag und derselbe Stichtag ein Jahr früher"
      note={meterWords.historyNote}
      cards={lines.map((line) => ({
        key: line.keyDate,
        title: date(line.keyDate),
        sub: [
          said_(line.consumption, line.keyDate),
          `${meterWords.previousYear} ${said_(line.previousYear)}`,
        ].join(' · '),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[110px]">{meterWords.untilKeyDate}</Column>
          <Column className="w-[120px] min-w-[110px] text-right">{meterWords.consumption}</Column>
          <Column className="w-[120px] min-w-[110px] text-right">{meterWords.previousYear}</Column>
          <Column className="w-[120px] min-w-[110px] text-right">{meterWords.change}</Column>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.keyDate}>
            <Cell>{date(line.keyDate)}</Cell>
            <Cell className="text-right">
              {line.consumption?.kind === 'consumed' ? (
                said_(line.consumption, line.keyDate)
              ) : (
                <span className="text-ink-faint">{said_(line.consumption, line.keyDate)}</span>
              )}
            </Cell>
            <Cell className="text-right">
              {line.previousYear?.kind === 'consumed' ? (
                said_(line.previousYear)
              ) : (
                <span className="text-ink-faint">{said_(line.previousYear)}</span>
              )}
            </Cell>
            <Cell className="text-right">{changeWords(line.consumption, line.previousYear)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** A figure as typed into a field, in thousandths, or the sentence that says how it is written. */
function figureOf(typed: string): number | string {
  const read = scaledNumber(typed, 3)

  return read === null || read < 0 ? meterWords.aFigure : read
}

/** The card that enters a reading by hand, the key date following the day it was read. */
function ReadingCard({
  meter,
  onCancel,
  onDone,
}: {
  readonly meter: MeterDetails
  readonly onCancel: () => void
  readonly onDone: () => Promise<void>
}) {
  const client = useSync()
  const [typed, setTyped] = useState('')
  const [readOn, setReadOn] = useState(today())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)
  const keyDate = keyDateFor(readOn as IsoDate)

  async function save() {
    const value = figureOf(typed)

    if (typeof value === 'string') {
      setProblem(value)

      return
    }

    setWorking(true)
    setProblem(undefined)

    try {
      const result = await askAt(
        client,
        'POST',
        `/meters/${meter.assetId}/readings`,
        meter.assetId,
        {
          readOn,
          valueMilli: value,
        },
      )

      if (result.outcome === 'refused') {
        setProblem(refusalFor(result))

        return
      }

      await onDone()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={meterWords.enter}>
      <form
        noValidate
        className="flex flex-wrap items-start gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="w-[230px] max-sm:w-full">
          <Field
            label={meterWords.standAt(keyDate)}
            unit={meterUnitSymbol[meter.unit]}
            inputMode="decimal"
            value={typed}
            problem={problem}
            onChange={(event) => {
              setTyped(event.target.value)
            }}
          />
        </div>
        <div className="w-[150px] max-sm:w-full">
          <Field
            label={meterWords.readOn}
            type="date"
            max={today()}
            value={readOn}
            onChange={(event) => {
              if (event.target.value !== '') {
                setReadOn(event.target.value)
              }
            }}
          />
        </div>
        <div className="flex gap-2 pt-[22px] max-sm:pt-0">
          <Button type="button" disabled={working} onClick={onCancel}>
            {meterWords.cancel}
          </Button>
          <Button
            type="submit"
            tone="primary"
            icon={Check}
            disabled={working || typed.trim() === ''}
          >
            {working ? meterWords.wait : meterWords.save}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

/** The dialogs of the page of a measuring point. */
function MeterDialogs({
  meter,
  dialog,
  figure,
  onClose,
  onDone,
}: {
  readonly meter: MeterDetails
  readonly dialog: MeterDialog
  readonly figure: (milli: number) => string
  readonly onClose: () => void
  readonly onDone: () => Promise<void>
}) {
  const client = useSync()
  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    initialOf(meter, dialog),
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const sub = titleOf(meter)
  const unit = meterUnitSymbol[meter.unit]
  const field = (name: string) => values[name] ?? ''
  const put = (name: string) => (event: { readonly target: { readonly value: string } }) => {
    setValues((before) => ({ ...before, [name]: event.target.value }))
  }
  const candidates = useQuery({
    queryKey: [...meterKey, 'list', `property=${meter.propertyId}`],
    queryFn: () => request<MeterList>(`/meters?property=${meter.propertyId}`),
    enabled: dialog.kind === 'edit',
  })

  async function send(
    method: 'POST' | 'PUT',
    path: string,
    body: Readonly<Record<string, unknown>>,
  ) {
    setWorking(true)
    setProblem(null)

    try {
      const result = await askAt(client, method, path, meter.assetId, body as never)

      if (result.outcome === 'refused') {
        setProblem(refusalFor(result))

        return
      }

      await onDone()
    } finally {
      setWorking(false)
    }
  }

  /** A figure of a field, or null with the sentence said. */
  const figureFrom = (name: string): number | null => {
    const read = figureOf(field(name))

    if (typeof read === 'string') {
      setProblem(read)

      return null
    }

    return read
  }

  const base = `/meters/${meter.assetId}`
  let title = ''
  let width: 520 | 600 | 640 = 520
  let action = ''
  let icon = Check
  let body: ReactNode = null
  let submit: () => void = () => undefined

  switch (dialog.kind) {
    case 'exchange':
      title = meterWords.exchange
      width = 600
      action = 'Tausch eintragen'
      icon = ArrowLeftRight
      body = (
        <>
          <div className="w-[170px]">
            <Field
              label="Tag des Tauschs"
              type="date"
              required
              starred
              max={today()}
              value={field('exchangedOn')}
              onChange={put('exchangedOn')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              <p className="font-condensed text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
                Alter Zähler
              </p>
              <Field
                label={meterWords.meterNumber}
                value={meter.meterNumber}
                readOnly
                // Grey as the board draws a field that cannot be changed.
                className="bg-surface-sunken!"
              />
              <Field
                label="Endstand"
                required
                starred
                unit={unit}
                inputMode="decimal"
                value={field('oldEnd')}
                onChange={put('oldEnd')}
              />
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="font-condensed text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
                Neuer Zähler
              </p>
              <Field
                label={meterWords.meterNumber}
                required
                starred
                maxLength={meterLimits.meterNumber}
                value={field('newNumber')}
                onChange={put('newNumber')}
              />
              <Field
                label="Anfangsstand"
                required
                starred
                unit={unit}
                inputMode="decimal"
                value={field('newStart')}
                onChange={put('newStart')}
              />
            </div>
          </div>
          <NoteBox>
            Der Verbrauch rechnet über beide Zähler: bis zum Tausch am alten, danach am neuen. Die
            Messstelle bleibt dieselbe, mit ihrer Geschichte, und trägt ab jetzt die neue Nummer.
          </NoteBox>
        </>
      )
      submit = () => {
        const oldEndMilli = figureFrom('oldEnd')
        const newStartMilli = oldEndMilli === null ? null : figureFrom('newStart')

        if (oldEndMilli !== null && newStartMilli !== null) {
          void send('POST', `${base}/exchanges`, {
            exchangedOn: field('exchangedOn'),
            oldEndMilli,
            newNumber: field('newNumber'),
            newStartMilli,
          })
        }
      }
      break
    case 'pause':
      title = meterWords.pause
      width = 600
      action = meterWords.pause
      icon = Pause
      body = (
        <>
          <div className="flex flex-wrap gap-3.5">
            <div className="w-[170px]">
              <Field
                label="Von"
                type="date"
                required
                starred
                value={field('startsOn')}
                onChange={put('startsOn')}
              />
            </div>
            {/* The hint runs on beside the field, as the board draws it. */}
            <div className="min-w-0 grow">
              <Field
                label="Bis"
                type="date"
                className="w-[170px]!"
                hint="Leer, solange kein Ende feststeht."
                value={field('endsOn')}
                onChange={put('endsOn')}
              />
            </div>
          </div>
          <TextArea
            label="Grund"
            rows={2}
            required
            starred
            maxLength={meterLimits.reason}
            value={field('reason')}
            onChange={put('reason')}
          />
          <NoteBox>
            Für einen Stichtag in der Stilllegung fehlt kein Stand, und eine Zeit, die ganz in ihr
            liegt, hat keinen Verbrauch.
          </NoteBox>
        </>
      )
      submit = () => {
        void send('POST', `${base}/pauses`, {
          startsOn: field('startsOn'),
          endsOn: field('endsOn') === '' ? null : field('endsOn'),
          reason: field('reason'),
        })
      }
      break
    case 'endPause':
      title = 'Stilllegung beenden'
      action = meterWords.end
      body = (
        <>
          <TwoLines
            bold
            main={`Stillgelegt ${meterWords.since(dialog.startsOn)}`}
            sub={dialog.reason}
          />
          <div className="w-[170px]">
            <Field
              label="Letzter Tag"
              type="date"
              required
              starred
              min={dialog.startsOn}
              value={field('endsOn')}
              onChange={put('endsOn')}
            />
          </div>
        </>
      )
      submit = () => {
        void send('PUT', `${base}/pauses/${dialog.pauseId}`, { endsOn: field('endsOn') })
      }
      break
    case 'lock':
      title = meterWords.lock
      action = meterWords.lock
      icon = Lock
      body = (
        <>
          <TextArea
            label="Grund"
            rows={2}
            required
            starred
            maxLength={meterLimits.reason}
            hint="Steht an der Messstelle, im Büro und vor Ort."
            value={field('lockReason')}
            onChange={put('lockReason')}
          />
          <NoteBox>
            Eine gesperrte Messstelle nimmt keinen Stand an, bis die Sperre aufgehoben ist.
          </NoteBox>
        </>
      )
      submit = () => {
        void send('PUT', `${base}/lock`, { lockReason: field('lockReason') })
      }
      break
    case 'correct': {
      const reading = dialog.row.reading
      const original = dialog.row.corrected[dialog.row.corrected.length - 1] ?? reading

      title = 'Stand berichtigen'
      width = 600
      action = meterWords.correct
      body =
        reading === null || original === null ? null : (
          <>
            <FactList
              keyWidth={90}
              facts={[
                { label: meterWords.keyDate, value: date(dialog.row.keyDate) },
                { label: meterWords.stand, value: figure(reading.valueMilli) },
                { label: meterWords.read, value: `${date(original.readOn)}, ${original.name}` },
              ]}
            />
            <div className="flex flex-wrap gap-3.5">
              <div className="w-[230px] max-sm:w-full">
                <Field
                  label="Richtiger Stand"
                  required
                  starred
                  unit={unit}
                  inputMode="decimal"
                  value={field('value')}
                  onChange={put('value')}
                />
              </div>
              <div className="w-[150px] max-sm:w-full">
                <Field
                  label={meterWords.readOn}
                  type="date"
                  required
                  starred
                  max={today()}
                  value={field('readOn')}
                  onChange={put('readOn')}
                />
              </div>
            </div>
            <TextArea
              label="Grund"
              rows={2}
              required
              starred
              maxLength={meterLimits.reason}
              value={field('reason')}
              onChange={put('reason')}
            />
            <NoteBox>
              Der alte Stand bleibt stehen und gilt nicht mehr. Gerechnet wird mit dem neuen.
            </NoteBox>
          </>
        )
      submit = () => {
        const valueMilli = figureFrom('value')

        if (valueMilli !== null && reading !== null) {
          void send('POST', `${base}/readings`, {
            readOn: field('readOn'),
            valueMilli,
            correctsId: reading.id,
            correctionReason: field('reason'),
          })
        }
      }
      break
    }
    case 'edit': {
      const others = (candidates.data?.meters ?? []).filter(
        (each) => each.assetId !== meter.assetId,
      )

      title = 'Messstelle bearbeiten'
      action = meterWords.save
      body = (
        <>
          <div className="w-[120px]">
            <Field
              label={meterWords.factor}
              inputMode="numeric"
              hint="Womit das Zählwerk malgenommen wird, bei einem Wandler etwa 40."
              value={field('factor')}
              onChange={put('factor')}
            />
          </div>
          <SelectField
            label={meterWords.mainMeter}
            value={field('mainMeterId')}
            hint="Eine andere Messstelle dieser Liegenschaft, unter der diese zählt."
            options={[
              { value: '', label: 'Keiner' },
              ...others.map((each) => ({ value: each.assetId, label: titleOf(each) })),
            ]}
            onChange={(value) => {
              setValues((before) => ({ ...before, mainMeterId: value }))
            }}
          />
          <Field
            label={meterWords.controlId}
            placeholder="etwa GLT-SH-WZ01"
            maxLength={meterLimits.controlId}
            value={field('controlId')}
            onChange={put('controlId')}
          />
          <p className="text-[12px] text-ink-muted">
            Zählernummer und Einheit ändern sich mit einem Zählertausch.
          </p>
        </>
      )
      submit = () => {
        const factor = field('factor').trim()

        void send('PUT', base, {
          conversionFactor: factor === '' ? null : Number(factor),
          mainMeterId: field('mainMeterId') === '' ? null : field('mainMeterId'),
          controlId: field('controlId'),
        })
      }
      break
    }
    case 'note':
      title = meterWords.note
      action = meterWords.save
      body = (
        <TextArea
          label={meterWords.note}
          rows={3}
          maxLength={meterLimits.note}
          hint="Steht mit Ihrem Namen und dem Tag an der Messstelle, auch auf dem Gerät vor Ort. Leer entfernt sie."
          value={field('note')}
          onChange={put('note')}
        />
      )
      submit = () => {
        void send('PUT', `${base}/note`, { note: field('note') })
      }
      break
  }

  return (
    <Dialog title={title} width={width} onClose={onClose} sub={sub}>
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {body}
        {problem ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {problem}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            {meterWords.cancel}
          </Button>
          <Button type="submit" tone="primary" icon={icon} disabled={working}>
            {working ? meterWords.wait : action}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** What a dialog starts from. */
function initialOf(meter: MeterDetails, dialog: MeterDialog): Readonly<Record<string, string>> {
  switch (dialog.kind) {
    case 'exchange':
      return { exchangedOn: today(), newStart: meterFigure(0, meter.unit).split(' ')[0] ?? '0' }
    case 'pause':
      return { startsOn: today() }
    case 'endPause':
      return { endsOn: today() }
    case 'correct': {
      const original = dialog.row.corrected[dialog.row.corrected.length - 1] ?? dialog.row.reading

      return { readOn: original?.readOn ?? today() }
    }
    case 'edit':
      return {
        factor: String(meter.conversionFactor ?? 1),
        mainMeterId: meter.mainMeter?.assetId ?? '',
        controlId: meter.controlId ?? '',
      }
    case 'note':
      return { note: meter.note?.text ?? '' }
    default:
      return {}
  }
}
