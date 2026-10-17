import {
  type ConsumptionFigures,
  type DefectFigures,
  defectAgeBandLabel,
  defectAgeBands,
  type FaultFigures,
  type FaultFiguresRow,
  type FulfilmentRow,
  type IsoDate,
  measureColumnLabel,
  measureColumns,
  type MeasureRow,
  mediumKeyLabel,
  periodOf,
  type ReportGrid,
  reportGridLabel,
  reportGrids,
  reportPeriodProblems,
  type ReportView,
  reportViewLabel,
  reportViews,
  withoutClass,
} from '@opengewerk/haustechnik-domain'
import { Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { Empty, NoteBox, PageHead, Screen, useTableExport } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused, useRecords } from '@opengewerk/platform-web/sync'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useAreas } from '../../session/areas.js'
import { defectListPlace, defectSearch } from '../defect-addresses.js'
import {
  type FiguresAddress,
  figuresAddressOf,
  figuresPlace,
  figuresRequest,
  figuresSearch,
  monthsOf,
} from '../figures-addresses.js'
import { factLink } from '../links.js'
import { PlaceFilter, RegisterFilter } from '../register-filter.js'
import { Segmented } from '../segmented.js'
import { asTableAddress } from '../table-address.js'
import { ConsumptionTables } from './figures-consumption.js'

export const figuresWords = {
  sub: 'Kennzahlen über die Zeit, je Gebäude, Liegenschaft und Bereich. Keine Zahl je Person.',
  noConnection: 'Die Auswertungen kommen vom Server. Gerade ist keine Verbindung da.',
  loading: 'Die Auswertung wird geladen.',
  failed: 'Die Auswertung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
  duties:
    'Ein Termin zählt in dem Zeitraum, in dem er fällig wurde. Rechtzeitig ist ein Nachweis bis zum Tag, an dem der Termin eingehalten ist; eine Pflicht ohne ersten Nachweis hat noch keinen Termin und steht unter „Nie erfasst“ im Pflichtenverzeichnis.',
  person:
    'Ein Gebäude, für das nur eine Person zuständig ist, lässt auf sie schließen. Die Verfahrensbeschreibung sagt das; eine Auswertung je Person gibt es nicht.',
  defects:
    'Offen heute, wie in der Liste der Mängel: bis zur Nachprüfung. Das Alter zählt ab dem Tag, an dem der Mangel festgestellt wurde. „Offen“ und „Über Frist“ führen zur Liste der Mängel mit demselben Filter.',
  noDefects: 'Gerade ist kein Mangel offen.',
  faults:
    'Eingegangen im Zeitraum; die Zeiten sind der Median in Tagen. Zusammengeführte Meldungen zählen mit der, unter der sie stehen. Gezählt wird je Kategorie und Gebäude, nie je Person, auch nicht, wer gemeldet hat.',
  noFaults: 'In diesem Zeitraum ist keine Störung eingegangen.',
  activities:
    'Ein Vorgang zählt in dem Zeitraum, in dem er abgeschlossen wurde. Rundgänge und Prüfungen sind Inspektion, Störungen und Mängel Instandsetzung; ein sonstiger Auftrag nennt seine Maßnahme selbst, ein älterer ohne steht unter „Ohne Zuordnung“.',
  noTime: 'keine',
} as const

/** How far back the months of the filter reach: ten years, the newest first. */
const yearsToChoose = 10

/** The months a filter offers, from the January ten years back to this month. */
function monthChoices(on: IsoDate): readonly { readonly value: string; readonly label: string }[] {
  const [year, month] = on.split('-').map(Number) as [number, number]
  const last = year * 12 + (month - 1)
  const first = (year - yearsToChoose + 1) * 12
  const months: { value: string; label: string }[] = []

  for (let at = last; at >= first; at -= 1) {
    const value = `${String(Math.floor(at / 12))}-${String((at % 12) + 1).padStart(2, '0')}`

    months.push({ value, label: periodOf(`${value}-01`, 'month').label })
  }

  return months
}

/** A count as a person reads it. */
function count(value: number): string {
  return value.toLocaleString('de-DE')
}

/** A number of days, one place after the comma, or "keine" for none. */
function DaysCell({ days }: { readonly days: number | null }) {
  return (
    <Cell numeric>
      {days === null ? (
        <span className="text-ink-faint">{figuresWords.noTime}</span>
      ) : (
        `${days.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Tage`
      )}
    </Cell>
  )
}

/** The share of a period as a bar, `bar()` of the board: on time, later, open. For the eye; the figures stand beside it. */
function ShareBar({ row }: { readonly row: FulfilmentRow }) {
  const total = row.due === 0 ? 1 : row.due
  const part = (value: number, colour: string) =>
    value === 0 ? null : (
      <span
        className={`block h-full ${colour}`}
        style={{ width: `${String((100 * value) / total)}%` }}
      />
    )

  return (
    <span
      aria-hidden="true"
      className="flex h-2.5 w-[160px] overflow-hidden rounded-[2px] bg-surface-sunken"
    >
      {part(row.onTime, 'bg-done')}
      {part(row.late, 'bg-waiting')}
      {part(row.open, 'bg-conflict')}
    </span>
  )
}

/** The word of the first column: the period of the grid. */
function periodWord(grid: ReportGrid): string {
  return reportGridLabel[grid]
}

function DutyFigures({
  rows,
  grid,
}: {
  readonly rows: readonly FulfilmentRow[]
  readonly grid: ReportGrid
}) {
  return (
    <TablePanel
      caption="Erfüllung der Pflichten je Zeitraum: fällig geworden, rechtzeitig, später und noch offen"
      note={figuresWords.duties}
      cards={rows.map((row) => ({
        key: row.key,
        title: row.label,
        sub: `${count(row.due)} fällig, ${count(row.onTime)} rechtzeitig, ${count(row.late)} später, ${count(row.open)} offen`,
        right: row.due === 0 ? null : `${String(Math.round((100 * row.onTime) / row.due))} %`,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[140px]">{periodWord(grid)}</Column>
          <Column numeric className="w-[130px] min-w-[110px]">
            Fällig geworden
          </Column>
          <Column numeric className="w-[110px] min-w-[96px]">
            Rechtzeitig
          </Column>
          <Column numeric className="w-[90px] min-w-[80px]">
            Später
          </Column>
          <Column numeric className="w-[100px] min-w-[90px]">
            Noch offen
          </Column>
          <Column numeric className="w-[130px] min-w-[110px]">
            Rechtzeitig in %
          </Column>
          <Column className="w-[190px] min-w-[180px]">
            <span className="sr-only">Anteile</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <Cell>{row.label}</Cell>
            <Cell numeric>{count(row.due)}</Cell>
            <Cell numeric>{count(row.onTime)}</Cell>
            <Cell numeric>{count(row.late)}</Cell>
            <Cell numeric>
              <span className={row.open === 0 ? undefined : 'text-conflict'}>
                {count(row.open)}
              </span>
            </Cell>
            <Cell numeric>
              {row.due === 0 ? '' : `${String(Math.round((100 * row.onTime) / row.due))} %`}
            </Cell>
            <Cell>
              <ShareBar row={row} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * The open defects by class and age. "Offen" and "Über Frist" lead to the
 * list of the defects with the same place and class; an age has no filter
 * there, so its figures stand as they are.
 */
function DefectFiguresTable({
  figures,
  address,
}: {
  readonly figures: DefectFigures
  readonly address: FiguresAddress
}) {
  const reads = useRight('defect.read')
  const toList = (defectClass: string | null, overdue: boolean) =>
    defectSearch({
      ...(overdue ? { state: 'overdue' as const } : {}),
      defectClass: defectClass ?? withoutClass,
      ...(address.areaId === undefined ? {} : { areaId: address.areaId }),
      ...(address.propertyId === undefined ? {} : { propertyId: address.propertyId }),
      ...(address.buildingId === undefined ? {} : { buildingId: address.buildingId }),
    })
  const linked = (value: number, defectClass: string | null, overdue: boolean) =>
    reads && value > 0 ? (
      <Link to={defectListPlace.to} search={toList(defectClass, overdue)} className={factLink}>
        {count(value)}
      </Link>
    ) : (
      <span className={value === 0 ? 'text-ink-faint' : undefined}>{count(value)}</span>
    )

  if (figures.rows.length === 0) {
    return (
      <Panel>
        <Empty>{figuresWords.noDefects}</Empty>
      </Panel>
    )
  }

  return (
    <TablePanel
      caption="Offene Mängel nach Klasse und Alter, und wie viele über ihrer Frist sind"
      note={figuresWords.defects}
      cards={figures.rows.map((row) => ({
        key: row.defectClass ?? withoutClass,
        title: row.label,
        sub: defectAgeBands
          .filter((band) => row.bands[band] > 0)
          .map((band) => `${count(row.bands[band])} ${defectAgeBandLabel[band]}`)
          .join(', '),
        right: `${count(row.open)} offen${row.overdue === 0 ? '' : `, ${count(row.overdue)} über Frist`}`,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[160px]">Klasse</Column>
          {defectAgeBands.map((band) => (
            <Column key={band} numeric className="w-[120px] min-w-[100px]">
              {defectAgeBandLabel[band]}
            </Column>
          ))}
          <Column numeric className="w-[90px] min-w-[80px]">
            Offen
          </Column>
          <Column numeric className="w-[100px] min-w-[90px]">
            Über Frist
          </Column>
        </tr>
      </thead>
      <tbody>
        {figures.rows.map((row) => (
          <tr key={row.defectClass ?? withoutClass}>
            <Cell>{row.label}</Cell>
            {defectAgeBands.map((band) => (
              <Cell key={band} numeric>
                <span className={row.bands[band] === 0 ? 'text-ink-faint' : undefined}>
                  {count(row.bands[band])}
                </span>
              </Cell>
            ))}
            <Cell numeric>{linked(row.open, row.defectClass, false)}</Cell>
            <Cell numeric>
              <span className={row.overdue === 0 ? undefined : 'font-semibold text-conflict'}>
                {linked(row.overdue, row.defectClass, true)}
              </span>
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function FaultTable({
  title,
  rows,
  byBuilding,
  note,
}: {
  readonly title: string
  readonly rows: readonly FaultFiguresRow[]
  readonly byBuilding: boolean
  readonly note?: string
}) {
  return (
    <TablePanel
      title={title}
      caption={`Störungen ${byBuilding ? 'nach Gebäude' : 'nach Kategorie'}: eingegangen, angenommen, erledigt und die Zeit bis dahin`}
      {...(note === undefined ? {} : { note })}
      cards={rows.map((row) => ({
        key: row.key,
        title: row.label,
        sub: [
          row.sub,
          `${count(row.received)} eingegangen, ${count(row.accepted)} angenommen, ${count(row.done)} erledigt`,
        ]
          .filter((part) => part !== null)
          .join(' · '),
        right: null,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[180px]">{byBuilding ? 'Gebäude' : 'Kategorie'}</Column>
          <Column numeric className="w-[110px] min-w-[96px]">
            Eingegangen
          </Column>
          <Column numeric className="w-[110px] min-w-[96px]">
            Angenommen
          </Column>
          <Column numeric className="w-[90px] min-w-[80px]">
            Erledigt
          </Column>
          {byBuilding ? null : (
            <Column numeric className="w-[100px] min-w-[90px]">
              Abgelehnt
            </Column>
          )}
          <Column numeric className="w-[130px] min-w-[110px]">
            Bis zur Annahme
          </Column>
          <Column numeric className="w-[140px] min-w-[120px]">
            Bis zur Erledigung
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <Cell>
              {row.sub === null ? (
                row.label
              ) : (
                <div className="leading-[1.32]">
                  <div className="font-medium">{row.label}</div>
                  <div className="text-[12px] text-ink-faint">{row.sub}</div>
                </div>
              )}
            </Cell>
            <Cell numeric>{count(row.received)}</Cell>
            <Cell numeric>{count(row.accepted)}</Cell>
            <Cell numeric>{count(row.done)}</Cell>
            {byBuilding ? null : <Cell numeric>{count(row.rejected)}</Cell>}
            <DaysCell days={row.daysToAcceptance} />
            <DaysCell days={row.daysToDone} />
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function FaultFiguresTables({ figures }: { readonly figures: FaultFigures }) {
  if (figures.byCategory.length === 0) {
    return (
      <Panel>
        <Empty>{figuresWords.noFaults}</Empty>
      </Panel>
    )
  }

  return (
    <>
      <FaultTable title="Nach Kategorie" rows={figures.byCategory} byBuilding={false} />
      <FaultTable
        title="Nach Gebäude"
        rows={figures.byBuilding}
        byBuilding
        note={figuresWords.faults}
      />
    </>
  )
}

function ActivityFigures({
  rows,
  grid,
}: {
  readonly rows: readonly MeasureRow[]
  readonly grid: ReportGrid
}) {
  return (
    <TablePanel
      caption="Vorgänge je Zeitraum nach den Grundmaßnahmen der DIN 31051"
      note={figuresWords.activities}
      cards={rows.map((row) => ({
        key: row.key,
        title: row.label,
        sub: measureColumns
          .filter((column) => row.counts[column] > 0)
          .map((column) => `${count(row.counts[column])} ${measureColumnLabel[column]}`)
          .join(', '),
        right: `${count(row.total)} zusammen`,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[140px]">{periodWord(grid)}</Column>
          {measureColumns.map((column) => (
            <Column key={column} numeric className="w-[120px] min-w-[100px]">
              {measureColumnLabel[column]}
            </Column>
          ))}
          <Column numeric className="w-[100px] min-w-[90px]">
            Zusammen
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <Cell>{row.label}</Cell>
            {measureColumns.map((column) => (
              <Cell key={column} numeric>
                <span className={row.counts[column] === 0 ? 'text-ink-faint' : undefined}>
                  {count(row.counts[column])}
                </span>
              </Cell>
            ))}
            <Cell numeric>{count(row.total)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The views, `tabs()` of the board, each behind a word of the address. */
function FiguresTabs({ address }: { readonly address: FiguresAddress }) {
  return (
    <nav
      aria-label="Bereiche der Seite"
      className="flex flex-wrap gap-x-[22px] border-b border-line"
    >
      {reportViews.map((view) => (
        <Link
          key={view}
          to={figuresPlace.to}
          search={figuresSearch({ ...address, view })}
          {...(view === address.view ? { 'aria-current': 'page' as const } : {})}
          className={
            view === address.view
              ? 'border-b-2 border-copper px-0.5 py-2 text-[14px] font-semibold text-ink no-underline'
              : 'border-b-2 border-transparent px-0.5 py-2 text-[14px] text-ink-muted no-underline'
          }
        >
          {reportViewLabel[view]}
        </Link>
      ))}
    </nav>
  )
}

/** What a view answers, by its view. */
type Answer =
  | { readonly view: 'duties'; readonly rows: readonly FulfilmentRow[] }
  | { readonly view: 'defects'; readonly figures: DefectFigures }
  | { readonly view: 'faults'; readonly figures: FaultFigures }
  | { readonly view: 'activities'; readonly rows: readonly MeasureRow[] }
  | { readonly view: 'consumption'; readonly figures: ConsumptionFigures }

async function answerOf(view: ReportView, path: string): Promise<Answer> {
  switch (view) {
    case 'duties':
      return { view, rows: await request<readonly FulfilmentRow[]>(path) }
    case 'defects':
      return { view, figures: await request<DefectFigures>(path) }
    case 'faults':
      return { view, figures: await request<FaultFigures>(path) }
    case 'activities':
      return { view, rows: await request<readonly MeasureRow[]>(path) }
    case 'consumption':
      return { view, figures: await request<ConsumptionFigures>(path) }
  }
}

/**
 * "Auswertungen" in the office, the four boards of `ht_b_auswertung.py` (4.16 of
 * the concept, #334): the fulfilment of the duties per period, the defects
 * open today by class and age, the faults by category and building, and the
 * activities by the basic measures of DIN 31051, and since #335 the
 * consumption of the meters per building and medium. Narrowed by place, area,
 * months and grid, each in the address, and as a table with what the filter
 * shows. Never a figure per person: nothing here names one, and the views
 * count per place, class, category and period.
 *
 * The figures come from the server and need a connection.
 */
export function FiguresScreen() {
  const search = useSearch({ strict: false })
  const address = useMemo(() => figuresAddressOf(search), [search])
  const navigate = useNavigate()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const areas = useAreas()
  const on = today()
  const months = monthsOf(address, on)
  const grid = address.grid ?? 'month'
  const problem = reportPeriodProblems(months)['period']
  const path = figuresRequest(address, on)
  const asked = useQuery({
    queryKey: ['reports', path],
    queryFn: () => answerOf(address.view, path),
    enabled: problem === undefined,
    placeholderData: keepPreviousData,
    // A refusal is an answer: asking again brings the same one.
    retry: (times, error) => !(error instanceof RequestRefused) && times < 2,
  })
  // What the view shows under its filter, as a table (#236).
  const table = useTableExport(asTableAddress(path))
  const answer = asked.data?.view === address.view ? asked.data : undefined
  const choices = monthChoices(on)
  const consumption = answer?.view === 'consumption' ? answer.figures : undefined
  // The media of the place as the server named them, or the one the address names while it is asked.
  const mediums = consumption?.choices ?? (address.medium === undefined ? [] : [address.medium])

  /** The address with some parts changed, a part left out for none. */
  const set = (change: Partial<Record<keyof FiguresAddress, string | undefined>>) => {
    const next = { ...address, ...change } as Record<string, unknown>

    for (const name of Object.keys(next)) {
      if (next[name] === undefined || next[name] === '') {
        delete next[name]
      }
    }

    void navigate({
      to: figuresPlace.to,
      search: figuresSearch(next as unknown as FiguresAddress),
      replace: true,
    })
  }

  return (
    <Screen>
      <PageHead title="Auswertungen" sub={figuresWords.sub} actions={table.button} />
      {table.trouble}
      <FiguresTabs address={address} />
      <div className="flex flex-wrap items-end gap-2.5">
        <PlaceFilter
          className="lg:w-[220px]"
          place={address}
          properties={properties}
          buildings={buildings}
          onPlace={(place) => {
            set({ propertyId: place.propertyId, buildingId: place.buildingId })
          }}
        />
        {areas.length > 1 ? (
          <RegisterFilter
            label="Bereich"
            className="lg:w-[150px]"
            value={address.areaId ?? ''}
            onChange={(value) => {
              set({ areaId: value })
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
        {address.view === 'defects' ? null : (
          <>
            <RegisterFilter
              label="Von"
              className="lg:w-[160px]"
              value={months.from}
              onChange={(value) => {
                set({ from: value })
              }}
            >
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </RegisterFilter>
            <RegisterFilter
              label="Bis"
              className="lg:w-[160px]"
              value={months.to}
              onChange={(value) => {
                set({ to: value })
              }}
            >
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </RegisterFilter>
          </>
        )}
        {address.view === 'consumption' ? (
          <RegisterFilter
            label="Medium"
            className="lg:w-[160px]"
            value={consumption?.chosen ?? address.medium ?? ''}
            onChange={(value) => {
              set({ medium: value })
            }}
          >
            {mediums.length === 0 ? <option value="">Keine Zähler</option> : null}
            {mediums.map((key) => (
              <option key={key} value={key}>
                {mediumKeyLabel(key)}
              </option>
            ))}
          </RegisterFilter>
        ) : null}
        {address.view === 'duties' ||
        address.view === 'activities' ||
        address.view === 'consumption' ? (
          <div className="flex flex-col gap-[3px]">
            <span className="text-[12px] text-ink-faint max-lg:text-[13px]">Raster</span>
            <Segmented
              label="Raster"
              options={reportGrids.map((each) => reportGridLabel[each])}
              chosen={reportGrids.indexOf(grid)}
              onChoose={(index) => {
                set({ grid: reportGrids[index] })
              }}
            />
          </div>
        ) : null}
      </div>
      {problem !== undefined ? (
        <NoteBox tone="conflict">
          <span role="alert">{problem}</span>
        </NoteBox>
      ) : answer === undefined ? (
        <Panel>
          <Empty>
            {asked.isError
              ? asked.error instanceof RequestRefused
                ? asked.error.message
                : figuresWords.failed
              : asked.fetchStatus === 'paused'
                ? figuresWords.noConnection
                : figuresWords.loading}
          </Empty>
        </Panel>
      ) : answer.view === 'duties' ? (
        <>
          <DutyFigures rows={answer.rows} grid={grid} />
          <NoteBox>{figuresWords.person}</NoteBox>
        </>
      ) : answer.view === 'defects' ? (
        <DefectFiguresTable figures={answer.figures} address={address} />
      ) : answer.view === 'faults' ? (
        <FaultFiguresTables figures={answer.figures} />
      ) : answer.view === 'activities' ? (
        <ActivityFigures rows={answer.rows} grid={grid} />
      ) : (
        <ConsumptionTables figures={answer.figures} grid={grid} />
      )}
    </Screen>
  )
}
