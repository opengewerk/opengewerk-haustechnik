import {
  type ConsumptionBuildingRow,
  type ConsumptionCourseRow,
  type ConsumptionFigures,
  type ConsumptionMeterRow,
  type MediumKey,
  meterFigure,
  type ReportGrid,
  reportGridLabel,
  type SumUnit,
} from '@opengewerk/haustechnik-domain'
import { Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { Empty } from '@opengewerk/platform-web/office'
import { Link } from '@tanstack/react-router'

import { factLink } from '../links.js'
import { meterPlaces } from '../meter-addresses.js'

export const consumptionWords = {
  course:
    'Ein Verbrauch zählt im Monat seines Stichtags, wie auf der Seite der Messstelle. Fehlt zum Stichtag ein Stand, steht dort eine Lücke: geschätzt wird nicht. Über einen Zählertausch rechnet der Verbrauch über beide Geräte; eine stillgelegte Messstelle zählt in ihrer Stilllegung nicht mit und eine neue erst ab ihrem ersten Stand. Hat eine Messstelle noch keinen, ist jeder fällige Stichtag seit ihrer Anlage eine Lücke.',
  meters:
    'Ein Unterzähler zählt einmal: der Hauptzähler steht mit seinem Rest, was er ohne seine Unterzähler gemessen hat. Fehlt einem Unterzähler ein Stand, ist auch der Rest eine Lücke. Wer einen Stand abgelesen hat, steht hier nicht.',
  none: 'An diesem Standort gibt es keine Zähler.',
  gap: 'Lücke',
  notDue: 'noch nicht fällig',
  notRead: 'noch kein Stand',
  rest: 'Rest ohne Unterzähler',
  takenOver: 'mit übernommenem Stand',
} as const

/** The unit a medium is summed in. */
export function unitOf(key: MediumKey): SumUnit {
  return key.split(':')[1] as SumUnit
}

/** What a row counts with: a sum, and whether anything at it had a reading by then. */
interface Counted {
  readonly milli: number | null
  readonly previousMilli: number | null
  readonly read: boolean
  readonly readBefore: boolean
}

/** A sum in its unit as a cell says it: "Lücke" where a reading is missing, "noch kein Stand" before the first. */
function Amount({
  milli,
  unit,
  read,
}: {
  readonly milli: number | null
  readonly unit: SumUnit
  readonly read: boolean
}) {
  return !read ? (
    <span className="text-ink-faint">{consumptionWords.notRead}</span>
  ) : milli === null ? (
    <span className="text-ink-faint">{consumptionWords.gap}</span>
  ) : (
    <>{meterFigure(milli, unit)}</>
  )
}

/** The same in words, for a card. */
function amountText(milli: number | null, unit: SumUnit, read: boolean): string {
  return !read
    ? consumptionWords.notRead
    : milli === null
      ? consumptionWords.gap
      : meterFigure(milli, unit)
}

/** How much more or less than the year before, `+6 %`, or nothing where one of them is not known. */
function changeOf(row: Counted): string | null {
  const { milli, previousMilli } = row

  if (
    !row.read ||
    !row.readBefore ||
    milli === null ||
    previousMilli === null ||
    previousMilli === 0
  ) {
    return null
  }

  const share = Math.round(((milli - previousMilli) / previousMilli) * 100)

  return `${share > 0 ? '+' : ''}${String(share)} %`
}

/** The change, red where more was consumed, as the board draws it. */
function ChangeCell({ row }: { readonly row: Counted }) {
  const change = changeOf(row)

  return (
    <Cell numeric>
      {change === null ? (
        ''
      ) : (
        <span className={change.startsWith('+') ? 'text-conflict' : undefined}>{change}</span>
      )}
    </Cell>
  )
}

function Course({
  rows,
  grid,
  unit,
}: {
  readonly rows: readonly ConsumptionCourseRow[]
  readonly grid: ReportGrid
  readonly unit: SumUnit
}) {
  const shown = (row: ConsumptionCourseRow) =>
    row.due ? (
      <Amount milli={row.milli} unit={unit} read={row.read} />
    ) : (
      <span className="text-ink-faint">{consumptionWords.notDue}</span>
    )

  return (
    <TablePanel
      title="Verlauf"
      caption="Verbrauch je Zeitraum mit dem Vorjahr und den Messstellen mit Lücke"
      note={consumptionWords.course}
      cards={rows.map((row) => ({
        key: row.key,
        title: row.label,
        sub: [
          row.due ? amountText(row.milli, unit, row.read) : consumptionWords.notDue,
          `Vorjahr: ${amountText(row.previousMilli, unit, row.readBefore)}`,
          row.withGap > 0 ? `${String(row.withGap)} mit Lücke` : null,
        ]
          .filter((part) => part !== null)
          .join(' · '),
        right: changeOf(row),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[140px]">{reportGridLabel[grid]}</Column>
          <Column numeric className="w-[150px] min-w-[120px]">
            Verbrauch
          </Column>
          <Column numeric className="w-[150px] min-w-[120px]">
            Vorjahr
          </Column>
          <Column numeric className="w-[120px] min-w-[100px]">
            Veränderung
          </Column>
          <Column numeric className="w-[110px] min-w-[96px]">
            Mit Lücke
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <Cell>{row.label}</Cell>
            <Cell numeric>{shown(row)}</Cell>
            <Cell numeric>
              <Amount milli={row.previousMilli} unit={unit} read={row.readBefore} />
            </Cell>
            <ChangeCell row={row} />
            <Cell numeric>
              <span className={row.withGap > 0 ? 'text-conflict' : 'text-ink-faint'}>
                {String(row.withGap)}
              </span>
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function Buildings({
  rows,
  unit,
}: {
  readonly rows: readonly ConsumptionBuildingRow[]
  readonly unit: SumUnit
}) {
  return (
    <TablePanel
      title="Je Gebäude"
      caption="Verbrauch je Gebäude im Zeitraum mit dem Vorjahr"
      cards={rows.map((row) => ({
        key: row.buildingId,
        title: row.label,
        sub: [row.sub, amountText(row.milli, unit, row.read)].join(' · '),
        right: changeOf(row),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[180px]">Gebäude</Column>
          <Column numeric className="w-[150px] min-w-[120px]">
            Verbrauch
          </Column>
          <Column numeric className="w-[150px] min-w-[120px]">
            Vorjahr
          </Column>
          <Column numeric className="w-[120px] min-w-[100px]">
            Veränderung
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.buildingId}>
            <Cell>
              <div className="leading-[1.32]">
                <div className="font-medium">{row.label}</div>
                <div className="text-[12px] text-ink-faint">{row.sub}</div>
              </div>
            </Cell>
            <Cell numeric>
              <Amount milli={row.milli} unit={unit} read={row.read} />
            </Cell>
            <Cell numeric>
              <Amount milli={row.previousMilli} unit={unit} read={row.readBefore} />
            </Cell>
            <ChangeCell row={row} />
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** What a measuring point says under its name: where it stands and what is to know of its figures. */
function remarksOf(row: ConsumptionMeterRow): string {
  return [
    row.building,
    row.rest ? consumptionWords.rest : null,
    row.under === null ? null : `unter ${row.under}`,
    row.takenOver ? consumptionWords.takenOver : null,
    ...row.exchangedOn.map((day) => `getauscht am ${date(day)}`),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

function Meters({
  rows,
  unit,
}: {
  readonly rows: readonly ConsumptionMeterRow[]
  readonly unit: SumUnit
}) {
  const name = (row: ConsumptionMeterRow) => [row.mark, row.name].filter(Boolean).join(' ')

  return (
    <TablePanel
      title="Je Messstelle"
      caption="Verbrauch je Messstelle im Zeitraum mit dem Vorjahr, Hauptzähler mit ihrem Rest"
      note={consumptionWords.meters}
      cards={rows.map((row) => ({
        key: row.assetId,
        title: name(row),
        sub: [remarksOf(row), amountText(row.milli, unit, row.read)].join(' · '),
        right: changeOf(row),
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[220px]">Messstelle</Column>
          <Column numeric className="w-[150px] min-w-[120px]">
            Verbrauch
          </Column>
          <Column numeric className="w-[150px] min-w-[120px]">
            Vorjahr
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.assetId}>
            <Cell>
              {/* A sub-meter stands indented under its main meter. */}
              <div
                className="leading-[1.32]"
                style={{ paddingLeft: `${String(row.depth * 18)}px` }}
              >
                <Link to={meterPlaces.meter(row.assetId)} className={factLink}>
                  {name(row)}
                </Link>
                <div className="text-[12px] text-ink-faint">{remarksOf(row)}</div>
              </div>
            </Cell>
            <Cell numeric>
              <Amount milli={row.milli} unit={unit} read={row.read} />
            </Cell>
            <Cell numeric>
              <Amount milli={row.previousMilli} unit={unit} read={row.readBefore} />
            </Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/**
 * "Verbrauch" in the figures over time, the board of the consumption in
 * `ht_b_auswertung.py` (#335): the course of a medium with the
 * year before, the buildings and the measuring points, a main meter with its
 * rest. A key date without a reading is a gap and never an estimate.
 */
export function ConsumptionTables({
  figures,
  grid,
}: {
  readonly figures: ConsumptionFigures
  readonly grid: ReportGrid
}) {
  if (figures.chosen === null) {
    return (
      <Panel>
        <Empty>{consumptionWords.none}</Empty>
      </Panel>
    )
  }

  const unit = unitOf(figures.chosen)

  return (
    <>
      <Course rows={figures.course} grid={grid} unit={unit} />
      <Buildings rows={figures.byBuilding} unit={unit} />
      <Meters rows={figures.byMeter} unit={unit} />
    </>
  )
}
