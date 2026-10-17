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
  type DefectFigures,
  defectAgeBandLabel,
  defectAgeBands,
  type FaultFigures,
  type FaultFiguresRow,
  type FiguresFilter,
  type FulfilmentRow,
  type IsoDate,
  lastTwelveMonths,
  measureColumnLabel,
  measureColumns,
  type MeasureRow,
  type ReportGrid,
  reportGrids,
  reportPeriodProblems,
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
import { activityFigures, defectFigures, dutyFigures, faultFigures } from '../figures/reading.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

type Question = Readonly<Record<string, unknown>>

/** The filter a question names: the place, the months and the grid, with the twelve months up to today where it names none. */
function filterOf(query: Question, today: IsoDate): FiguresFilter {
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

  return {
    from,
    to,
    grid: grid as ReportGrid,
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
}
