import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  addressWords,
  type Asset,
  type AssetBoard,
  type AssetBoardSection,
  type AssetCircuit,
  inStructureOrder,
  isAllowed,
  placeWords,
} from '@opengewerk/haustechnik-domain'
import {
  type ChartBoard,
  type CircuitChart,
  circuitChartJob,
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import {
  assets,
  boardSections,
  circuits,
  distributionBoards,
  properties,
} from '../database/schema/index.js'
import { keeperOf } from '../labels/faces.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, placeOf } from './places.js'
import { pdf, Printer } from './prints.controller.js'

const missingAsset = 'Diese Anlage gibt es nicht oder nicht mehr.'
const missingBoard = 'Diesen Verteiler gibt es an dieser Anlage nicht oder nicht mehr.'

/** A name as it may stand in a file name. A board called `UV 1/2` is one. */
function safe(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

/**
 * The circuit chart of a low-voltage installation (#349, section 4.2 of the
 * concept), for the door of its boards: one page a board, its circuits in the
 * order of the board and grouped by section, printed by the foundation
 * (`circuitChartJob`, ADR 0014 in the repository opengewerk).
 *
 * Under the asset, because it is a way of reading the asset and not a record
 * of its own, and under its right: whoever reads the asset reads its
 * structure and may print it. Printed on every request and kept nowhere, as
 * in the trades application: it records no act, and a chart kept from
 * yesterday is one that may already be wrong. An asset outside the areas of
 * whoever asks is not found, the same answer as one that is not there.
 *
 * `board` narrows it to one board, the one whose door it is for.
 */
@Controller('assets')
export class CircuitChartController {
  constructor(
    private readonly database: Database,
    private readonly printer: Printer,
  ) {}

  @Get(':id/circuit-chart')
  @RequiresPermission('asset.read')
  async print(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query('board') board: string | undefined,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    const chart = await this.database.forTenant(identity, (tx) => chartOf(tx, identity, id, board))
    const bytes = await this.printer.fresh(circuitChartJob(chart))
    const only = board === undefined ? null : chart.boards[0]
    const name = `Stromkreisverzeichnis ${safe(only ? only.designation : chart.installation)} ${dayInGermany()}`

    return pdf(response, bytes, name)
  }
}

/**
 * Everything the chart prints, read in one transaction so that it is one
 * state of the structure and not two. Only what is not marked as deleted; a
 * board that is not one of the asset is not found, as the asset is not.
 *
 * Who keeps the chart is the operator, by the name it was set up with; this
 * application knows no number of the operator, so the chart names none. Where
 * the installation stands, the property with its address, is printed only for
 * whoever reads places, as every list of the office names one (#237).
 */
async function chartOf(
  tx: TenantTransaction,
  identity: Asking,
  id: string,
  board: string | undefined,
): Promise<CircuitChart> {
  if (board !== undefined && !isUuid(board)) {
    throw new NotFoundException(missingBoard)
  }

  const asset = await placeOf<Asset>(tx, assets, id, missingAsset)
  const boards = (
    (await tx
      .select()
      .from(distributionBoards)
      .where(
        and(
          eq(distributionBoards.assetId, asset.id),
          isNull(distributionBoards.deletedAt),
          ...(board === undefined ? [] : [eq(distributionBoards.id, board as never)]),
        ),
      )) as AssetBoard[]
  ).sort(inStructureOrder)

  if (board !== undefined && boards.length === 0) {
    throw new NotFoundException(missingBoard)
  }

  const ids = boards.map((row) => row.id)
  const sections =
    ids.length === 0
      ? []
      : (
          (await tx
            .select()
            .from(boardSections)
            .where(
              and(inArray(boardSections.distributionBoardId, ids), isNull(boardSections.deletedAt)),
            )) as AssetBoardSection[]
        ).sort(inStructureOrder)
  const lines =
    ids.length === 0
      ? []
      : (
          (await tx
            .select()
            .from(circuits)
            .where(
              and(inArray(circuits.distributionBoardId, ids), isNull(circuits.deletedAt)),
            )) as AssetCircuit[]
        ).sort(inStructureOrder)

  const printed: ChartBoard[] = boards.map((row) => {
    const own = sections.filter((section) => section.distributionBoardId === row.id)
    const onBoard = lines.filter((circuit) => circuit.distributionBoardId === row.id)
    // A circuit whose section is gone hangs on the board directly: the key
    // empties the column when a section is removed for real, and one that is
    // only marked takes its circuits along and is left out of `own`.
    const known = new Set<string>(own.map((section) => section.id))
    const direct = onBoard.filter(
      (circuit) => circuit.boardSectionId === null || !known.has(circuit.boardSectionId),
    )
    const changed = [row, ...own, ...onBoard].reduce(
      (latest, part) => (part.updatedAt > latest ? part.updatedAt : latest),
      row.updatedAt,
    )

    return {
      designation: row.designation,
      kind: row.kind,
      location: row.location,
      changedOn: dayInGermany(changed),
      groups: [
        ...(direct.length > 0 || own.length === 0 ? [{ section: null, circuits: direct }] : []),
        ...own.map((section) => ({
          section: section.designation,
          circuits: onBoard.filter((circuit) => circuit.boardSectionId === section.id),
        })),
      ],
    }
  })

  return {
    keeper: { name: await keeperOf(tx), phone: null },
    installation: [asset.number, asset.name].filter(Boolean).join(' '),
    site: isAllowed(identity, 'location.read') ? await siteOf(tx, asset) : '',
    boards: printed,
  }
}

/** The property of the asset with its address, as one line. */
async function siteOf(tx: TenantTransaction, asset: Asset): Promise<string> {
  const [property] = await tx
    .select({
      name: properties.name,
      street: properties.street,
      postalCode: properties.postalCode,
      city: properties.city,
    })
    .from(properties)
    .where(eq(properties.id, asset.propertyId))

  return property === undefined ? '' : placeWords([property.name, addressWords(property)])
}
