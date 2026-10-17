import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  type Catalogue,
  type ConsumptionFigures,
  type DefectFigures,
  defectAgeBandLabel,
  defectAgeBands,
  type FaultFigures,
  type FaultFiguresRow,
  type FiguresFilter,
  type FulfilmentRow,
  type IsoDate,
  isMediumKey,
  lastTwelveMonths,
  type MediumKey,
  measureColumnLabel,
  measureColumns,
  type MeasureRow,
  meterUnitSymbol,
  type ReportGrid,
  reportGrids,
  reportPeriodProblems,
  type SumUnit,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  type OutgoingTable,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'

import { CATALOGUE } from '../catalogue.js'
import { consumptionFigures } from '../figures/consumption.js'
import { activityFigures, defectFigures, dutyFigures, faultFigures } from '../figures/reading.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

type Question = Readonly<Record<string, unknown>>

/** The filter a question names: the place, the months and the grid, with the twelve months up to today where it names none. */
function filterOf(
  query: Question,
  today: IsoDate,
): FiguresFilter & { readonly medium?: MediumKey } {
  const said = (key: string) =>
    typeof query[key] === 'string' && query[key] !== '' ? (query[key] as string) : undefined
  const twelve = lastTwelveMonths(today)
  const from = said('from') ?? twelve.from
  const to = said('to') ?? twelve.to
  const grid = said('grid') ?? 'month'
  const problems = reportPeriodProblems({ from, to })

  if (problems['period'] !== undefined) {
    throw new BadRequestException(problems['period'])
  }

  if (!(reportGrids as readonly string[]).includes(grid)) {
    throw new BadRequestException('Ein Raster ist ein Monat, ein Quartal oder ein Jahr.')
  }

  const areaId = said('areaId')
  const propertyId = said('propertyId')
  const buildingId = said('buildingId')
  const medium = said('medium')

  if (medium !== undefined && !isMediumKey(medium)) {
    throw new BadRequestException(
      'Ein Medium wird mit seiner Einheit genannt, etwa „electricity:kilowatt_hours“.',
    )
  }

  return {
    from,
    to,
    grid: grid as ReportGrid,
    ...(medium === undefined ? {} : { medium }),
    ...(areaId === undefined ? {} : { areaId }),
    ...(propertyId === undefined ? {} : { propertyId }),
    ...(buildingId === undefined ? {} : { buildingId }),
  }
}

function dutyTable(rows: readonly FulfilmentRow[]): OutgoingTable {
  return {
    name: 'Auswertung Pflichten',
    columns: ['Zeitraum', 'Fällig geworden', 'Rechtzeitig', 'Später', 'Noch offen'],
    rows: rows.map((row) => [row.label, row.due, row.onTime, row.late, row.open]),
  }
}

function defectTable(figures: DefectFigures): OutgoingTable {
  return {
    name: 'Auswertung Mängel',
    columns: [
      'Klasse',
      ...defectAgeBands.map((band) => defectAgeBandLabel[band]),
      'Offen',
      'Über Frist',
    ],
    rows: figures.rows.map((row) => [
      row.label,
      ...defectAgeBands.map((band) => row.bands[band]),
      row.open,
      row.overdue,
    ]),
  }
}

function faultTable(figures: FaultFigures): OutgoingTable {
  const line = (by: string, row: FaultFiguresRow) => [
    by,
    row.label,
    row.sub,
    row.received,
    row.accepted,
    row.done,
    row.rejected,
    // A median in days, or an empty cell for none.
    row.daysToAcceptance,
    row.daysToDone,
  ]

  return {
    name: 'Auswertung Störungen',
    columns: [
      'Nach',
      'Name',
      'Liegenschaft',
      'Eingegangen',
      'Angenommen',
      'Erledigt',
      'Abgelehnt',
      'Tage bis zur Annahme',
      'Tage bis zur Erledigung',
    ],
    rows: [
      ...figures.byCategory.map((row) => line('Kategorie', row)),
      ...figures.byBuilding.map((row) => line('Gebäude', row)),
    ],
  }
}

function activityTable(rows: readonly MeasureRow[]): OutgoingTable {
  return {
    name: 'Auswertung Vorgänge',
    columns: [
      'Zeitraum',
      ...measureColumns.map((column) => measureColumnLabel[column]),
      'Zusammen',
    ],
    rows: rows.map((row) => [
      row.label,
      ...measureColumns.map((column) => row.counts[column]),
      row.total,
    ]),
  }
}

/** A day as a table writes it, `03.06.2026`. */
function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

function consumptionTableOf(figures: ConsumptionFigures): OutgoingTable {
  const unit =
    figures.chosen === null ? '' : meterUnitSymbol[figures.chosen.split(':')[1] as SumUnit]
  // In whole units, or an empty cell for a gap or nothing read yet, which the remark names.
  const figure = (milli: number | null, read: boolean) =>
    milli === null || !read ? null : milli / 1000
  const remarks = (...parts: readonly (string | null | false)[]) =>
    parts.filter((part) => typeof part === 'string').join(', ')
  const nothing = (row: { readonly read: boolean; readonly readBefore: boolean }) => [
    !row.read && 'noch kein Stand',
    !row.readBefore && 'im Vorjahr noch kein Stand',
  ]

  return {
    name: 'Auswertung Verbrauch',
    columns: ['Nach', 'Name', 'Ort', 'Verbrauch', 'Vorjahr', 'Einheit', 'Hinweis'],
    rows: [
      ...figures.course.map((row) => [
        'Zeitraum',
        row.label,
        '',
        figure(row.milli, row.read),
        figure(row.previousMilli, row.readBefore),
        unit,
        row.due
          ? remarks(
              row.read && row.milli === null && 'Lücke',
              row.withGap > 0 && `${String(row.withGap)} mit Lücke`,
              ...nothing(row),
            )
          : 'noch nicht fällig',
      ]),
      ...figures.byBuilding.map((row) => [
        'Gebäude',
        row.label,
        row.sub,
        figure(row.milli, row.read),
        figure(row.previousMilli, row.readBefore),
        unit,
        remarks(row.read && row.milli === null && 'Lücke', ...nothing(row)),
      ]),
      ...figures.byMeter.map((row) => [
        'Messstelle',
        [row.mark, row.name].filter(Boolean).join(' '),
        row.building,
        figure(row.milli, row.read),
        figure(row.previousMilli, row.readBefore),
        unit,
        remarks(
          row.rest && 'Rest ohne Unterzähler',
          row.under !== null && `unter ${row.under}`,
          row.takenOver && 'mit übernommenem Stand',
          ...row.exchangedOn.map((day) => `getauscht am ${germanDay(day)}`),
          row.read && row.milli === null && 'Lücke',
          ...nothing(row),
        ),
      ]),
    ],
  }
}

/**
 * The figures over time, "Auswertungen" (section 4.16 of the concept, #334):
 * the fulfilment of the duties per period, the open defects by age and class,
 * the faults by category and building, the activities by DIN 31051, each as
 * a table too, with what the filter shows. For whoever may look at the
 * figures, in their areas: the transaction is theirs. No answer and no table
 * names a person or counts per person.
 */
@Controller('reports')
export class FiguresController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  private read<Result>(
    identity: Asking,
    work: (tx: TenantTransaction, today: IsoDate) => Promise<Result>,
  ): Promise<Result> {
    const today = dayInGermany()

    return this.database.forTenant(identity, (tx) => work(tx, today))
  }

  private table(
    identity: Asking,
    query: Question,
    make: (tx: TenantTransaction, today: IsoDate) => Promise<OutgoingTable>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)

    return this.read(identity, async (tx, today) =>
      tableAnswer(await make(tx, today), format, today),
    )
  }

  @Get('duties')
  @RequiresPermission('report.read')
  duties(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.read(identity, (tx, today) =>
      dutyFigures(tx, this.catalogue, today, filterOf(query, today)),
    )
  }

  @Get('duties/table')
  @RequiresPermission('report.read')
  @Header('Cache-Control', 'no-store')
  dutiesTable(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.table(identity, query, async (tx, today) =>
      dutyTable(await dutyFigures(tx, this.catalogue, today, filterOf(query, today))),
    )
  }

  @Get('defects')
  @RequiresPermission('report.read')
  defects(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.read(identity, (tx, today) =>
      defectFigures(tx, this.catalogue, today, filterOf(query, today)),
    )
  }

  @Get('defects/table')
  @RequiresPermission('report.read')
  @Header('Cache-Control', 'no-store')
  defectsTable(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.table(identity, query, async (tx, today) =>
      defectTable(await defectFigures(tx, this.catalogue, today, filterOf(query, today))),
    )
  }

  @Get('faults')
  @RequiresPermission('report.read')
  faults(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.read(identity, (tx, today) => faultFigures(tx, filterOf(query, today)))
  }

  @Get('faults/table')
  @RequiresPermission('report.read')
  @Header('Cache-Control', 'no-store')
  faultsTable(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.table(identity, query, async (tx, today) =>
      faultTable(await faultFigures(tx, filterOf(query, today))),
    )
  }

  @Get('activities')
  @RequiresPermission('report.read')
  activities(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.read(identity, (tx, today) => activityFigures(tx, filterOf(query, today)))
  }

  @Get('activities/table')
  @RequiresPermission('report.read')
  @Header('Cache-Control', 'no-store')
  activitiesTable(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.table(identity, query, async (tx, today) =>
      activityTable(await activityFigures(tx, filterOf(query, today))),
    )
  }

  @Get('consumption')
  @RequiresPermission('report.read')
  consumption(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.read(identity, (tx, today) =>
      consumptionFigures(tx, this.catalogue, today, filterOf(query, today)),
    )
  }

  @Get('consumption/table')
  @RequiresPermission('report.read')
  @Header('Cache-Control', 'no-store')
  consumptionTable(@CurrentIdentity() identity: Asking, @Query() query: Question) {
    return this.table(identity, query, async (tx, today) =>
      consumptionTableOf(
        await consumptionFigures(tx, this.catalogue, today, filterOf(query, today)),
      ),
    )
  }
}
