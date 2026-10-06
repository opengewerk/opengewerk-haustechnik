import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  assetImportFields,
  assetImportSummary,
  type AssetKindName,
  type Catalogue,
  decisionsOf,
  importLimits,
  kindNameKey,
  kindNamesProblem,
  planAssets,
  planChanged,
  planHasProblems,
  planMakesNothing,
  planStructure,
  sameCounts,
  structureDefaultsOf,
  structureFields,
  structureSummary,
  structureTotal,
  cellText,
  type ColumnMapping,
  columnMappingProblem,
  type TableField,
  type TableFile,
  type TableRecord,
  tableRecords,
  type TableSheet,
  tableSheetProblem,
} from '@opengewerk/haustechnik-domain'
import {
  AcceptsTable,
  AcceptsTableFile,
  CurrentIdentity,
  Database,
  newId,
  tableBodyOf,
  uploadedTable,
} from '@opengewerk/platform-server'
import { asc, sql } from 'drizzle-orm'

import { areasInSight } from '../areas/areas.js'
import { CATALOGUE } from '../catalogue.js'
import { assignNumbers } from '../database/number-ranges.js'
import {
  assetKindNames,
  assets,
  buildings,
  floors,
  properties,
  rooms,
} from '../database/schema/index.js'
import { assetImportStock, beginImport, inParts, structureStock } from '../imports/stock.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/** A request as the helpers of the foundation read it: the body is theirs to read, not a parser's. */
type Request = Parameters<typeof uploadedTable>[0]

/** The most problems and known lines one answer lists; how many there are beyond that it says. */
const listed = 200

/** What a preview answers with: a list cut to what a page shows, and how many more there are. */
function cut<Item>(items: readonly Item[]): { shown: readonly Item[]; more: number } {
  return { shown: items.slice(0, listed), more: Math.max(0, items.length - listed) }
}

/** What a request about a table carries beside the sheet and its columns. */
type Given = Readonly<Record<string, unknown>>

/**
 * The sheet a request carries as the records of its lines, or the sentence
 * about what is wrong with the sheet or with the choice of its columns.
 */
function recordsOf(
  body: unknown,
  fields: readonly TableField[],
): { given: Given; records: readonly TableRecord[] } {
  const given = (typeof body === 'object' && body !== null ? body : {}) as Given
  const problem =
    tableSheetProblem(given['sheet']) ??
    columnMappingProblem(given['mapping'], fields, given['sheet'] as TableSheet)

  if (problem) {
    throw new BadRequestException(problem)
  }

  return {
    given,
    records: tableRecords(given['sheet'] as TableSheet, given['mapping'] as ColumnMapping),
  }
}

/** The name of the file as the log keeps it; a request that names none is a table without a name. */
function fileNameOf(given: Given): string {
  const name = typeof given['fileName'] === 'string' ? cellText(given['fileName']) : ''

  // Cut where a space stands, the name would end in one, and the table takes no such name.
  return name === '' ? 'Tabelle ohne Namen' : name.slice(0, importLimits.fileName).trimEnd()
}

/**
 * The import of places and assets from tables (#100, sections 3 and 11 of
 * the concept): the file read into a table, the preview of what its lines
 * would make, and the take-over, whole or not at all.
 *
 * Reading a file and the preview write nothing. Both work a plan out
 * (`planStructure`, `planAssets` in `domain`) from the table and from what
 * the person asking can see. Taking over works the same plan out once more
 * inside the transaction that writes, refuses one with a problem and one
 * that is no longer what the page was shown, and writes the rest behind one
 * row in `imports`, which is the one entry of the change log.
 *
 * Places are imported by whoever keeps them (`location.write`), assets by
 * whoever keeps assets (`asset.write`), and both only into what they see: the
 * policy of the areas refuses a row beyond it, and the plan finds no place
 * there to put one into (ADR 0003).
 */
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Post('structure/table')
  @HttpCode(200)
  @RequiresPermission('location.write')
  @AcceptsTableFile()
  structureTable(@Req() request: Request): Promise<TableFile> {
    return uploadedTable(request)
  }

  @Post('structure/preview')
  @HttpCode(200)
  @RequiresPermission('location.write')
  @AcceptsTable()
  async structurePreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), structureFields)
    const defaults = structureDefaultsOf(given['defaults'])

    return this.database.readingTenant(identity, async (tx) => {
      const plan = planStructure(records, defaults, await structureStock(tx), newId)

      await this.areaInSight(tx, defaults.areaId, plan.counts.properties)

      const problems = cut(plan.problems)
      const known = cut(plan.known)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        known: known.shown,
        moreKnown: known.more,
      }
    })
  }

  @Post('structure')
  @RequiresPermission('location.write')
  @AcceptsTable()
  async takeStructure(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), structureFields)
    const defaults = structureDefaultsOf(given['defaults'])

    return this.database.forTenant(identity, async (tx) => {
      const plan = planStructure(records, defaults, await structureStock(tx), newId)

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (structureTotal(plan.counts) === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      await this.areaInSight(tx, defaults.areaId, plan.counts.properties)

      const summary = structureSummary(plan.counts)
      const id = await beginImport(tx, identity.tenantId, {
        kind: 'structure',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      const tenantId = identity.tenantId

      // Parents before their children: every row names the rows above it.
      for (const part of inParts(plan.create.properties)) {
        await tx.insert(properties).values(part.map((row) => ({ tenantId, ...row })))
      }

      for (const part of inParts(plan.create.buildings)) {
        await tx.insert(buildings).values(part.map((row) => ({ tenantId, ...row })))
      }

      for (const part of inParts(plan.create.floors)) {
        await tx.insert(floors).values(part.map((row) => ({ tenantId, ...row })))
      }

      for (const part of inParts(plan.create.rooms)) {
        await tx.insert(rooms).values(part.map((row) => ({ tenantId, ...row })))
      }

      return { id, counts: plan.counts, summary }
    })
  }

  @Post('assets/table')
  @HttpCode(200)
  @RequiresPermission('asset.write')
  @AcceptsTableFile()
  assetsTable(@Req() request: Request): Promise<TableFile> {
    return uploadedTable(request)
  }

  @Post('assets/preview')
  @HttpCode(200)
  @RequiresPermission('asset.write')
  @AcceptsTable()
  async assetsPreview(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), assetImportFields)

    return this.database.readingTenant(identity, async (tx) => {
      const plan = planAssets(
        records,
        decisionsOf(given['decisions']),
        await assetImportStock(tx, this.catalogue),
      )
      const problems = cut(plan.problems)

      return {
        lines: plan.lines,
        counts: plan.counts,
        problems: problems.shown,
        moreProblems: problems.more,
        // Every one of them, however many: each waits for an answer.
        duplicates: plan.duplicates,
      }
    })
  }

  @Post('assets')
  @RequiresPermission('asset.write')
  @AcceptsTable()
  async takeAssets(@CurrentIdentity() identity: Asking, @Req() request: Request) {
    const { given, records } = recordsOf(await tableBodyOf(request), assetImportFields)

    return this.database.forTenant(identity, async (tx) => {
      const plan = planAssets(
        records,
        decisionsOf(given['decisions']),
        await assetImportStock(tx, this.catalogue),
      )

      if (plan.problems.length > 0) {
        throw new UnprocessableEntityException(planHasProblems)
      }

      if (plan.counts.undecided > 0) {
        throw new UnprocessableEntityException(
          'Zu einer möglichen Dublette fehlt die Entscheidung. Es wurde nichts übernommen.',
        )
      }

      if (plan.create.length === 0) {
        throw new UnprocessableEntityException(planMakesNothing)
      }

      if (!sameCounts(given['expected'], { ...plan.counts })) {
        throw new ConflictException(planChanged)
      }

      const summary = assetImportSummary(plan.counts)
      const id = await beginImport(tx, identity.tenantId, {
        kind: 'assets',
        fileName: fileNameOf(given),
        lines: plan.lines,
        summary,
      })
      // The numbers in the order of the lines, drawn in one step from the
      // sequence of the tenant inside this transaction. The counter moves
      // once, which is one change in the log beside the import and not one
      // per asset, and an import that is refused takes them back with it.
      const numbers = await assignNumbers(
        tx,
        identity.tenantId,
        'asset',
        new Date(),
        plan.create.length,
      )
      const rows = plan.create.map(({ line: _line, ...asset }, index) => {
        const number = numbers[index]

        if (number === undefined) {
          throw new Error('Fewer numbers were drawn than the import makes assets')
        }

        return { tenantId: identity.tenantId, ...asset, parentAssetId: null, number, values: {} }
      })

      for (const part of inParts(rows)) {
        await tx.insert(assets).values(part)
      }

      return { id, counts: plan.counts, summary }
    })
  }

  /** What the lists of this tenant call the asset kinds, for the step that gives words a kind. */
  @Get('asset-kinds')
  @RequiresPermission('asset.write')
  kindNames(@CurrentIdentity() identity: Asking): Promise<{ names: AssetKindName[] }> {
    return this.database.forTenant(identity, async (tx) => ({
      names: await tx
        .select({ name: assetKindNames.name, kind: assetKindNames.kind })
        .from(assetKindNames)
        .orderBy(asc(assetKindNames.name)),
    }))
  }

  /**
   * Keeps which asset kind a word means. A word that is kept already is
   * corrected, compared as the import compares; one the request does not
   * name stays as it is.
   */
  @Put('asset-kinds')
  @RequiresPermission('asset.write')
  keepKindNames(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ names: AssetKindName[] }> {
    const today = dayInGermany()
    const problem = kindNamesProblem(body, (key) => this.catalogue.assetKind(key, today) !== null)

    if (problem) {
      throw new BadRequestException(problem)
    }

    const names = new Map(
      (body as { names: AssetKindName[] }).names.map((entry) => [kindNameKey(entry.name), entry]),
    )

    return this.database.forTenant(identity, async (tx) => {
      for (const [nameKey, entry] of names) {
        await tx
          .insert(assetKindNames)
          .values({
            tenantId: identity.tenantId,
            name: cellText(entry.name),
            nameKey,
            kind: entry.kind,
          })
          .onConflictDoUpdate({
            target: [assetKindNames.tenantId, assetKindNames.nameKey],
            set: { kind: entry.kind, updatedAt: sql`now()` },
            setWhere: sql`${assetKindNames.kind} is distinct from ${entry.kind}`,
          })
      }

      return {
        names: await tx
          .select({ name: assetKindNames.name, kind: assetKindNames.kind })
          .from(assetKindNames)
          .orderBy(asc(assetKindNames.name)),
      }
    })
  }

  /**
   * The area new properties are put into has to be one the person holds in.
   * The policy of the areas would refuse the row all the same; asked here,
   * the preview says so before anybody presses the button.
   */
  private async areaInSight(
    tx: Parameters<typeof areasInSight>[0],
    areaId: string | null,
    newProperties: number,
  ): Promise<void> {
    if (newProperties === 0 || areaId === null) {
      return
    }

    if (!(await areasInSight(tx)).some((area) => area.id === areaId)) {
      throw new BadRequestException(
        'Den Bereich für neue Liegenschaften gibt es bei diesem Betreiber nicht, oder Sie sehen ihn nicht.',
      )
    }
  }
}
