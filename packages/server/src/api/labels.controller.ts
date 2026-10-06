import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type AreaId,
  type Asset,
  type Building,
  type BuildingId,
  type Catalogue,
  isLabelCode,
  labelBatchMost,
  labelCountMax,
  type LabelFormat,
  type LabelId,
  labelPrintProblem,
  type LabelStandingAnswer,
  type PlaceLabel,
  type Property,
  type PropertyId,
  type Room,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUniqueViolation,
  isUuid,
  LabelCodeUnavailableError,
  type LabelFace,
  labelPrintJob,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
  type TenantTransaction,
  TRUSTED_ORIGINS,
  withLabelCode,
} from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import { CATALOGUE } from '../catalogue.js'
import {
  assets,
  buildings,
  floors,
  labelCodeIndex,
  labels,
  oneValidLabelIndexes,
  properties,
  rooms,
} from '../database/schema/index.js'
import { assetFaces, blankFace, keeperOf, roomFaces } from '../labels/faces.js'
import { dayInGermany } from '../today.js'
import { assetRegister, registerQuestion } from './asset-register.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, placeOf } from './places.js'

// The labels with a QR code on assets and rooms (#98, section 3 of the
// concept). Made and blocked here and nowhere else: the server draws the
// code, which is what keeps the address on a label from being guessed, and a
// device reads the rows through the sync. Printed on every request and kept
// nowhere.

const missingAsset = 'Diese Anlage gibt es nicht oder nicht mehr.'
const missingRoom = 'Diesen Raum gibt es nicht oder nicht mehr.'
const missingBuilding = 'Dieses Gebäude gibt es nicht oder nicht mehr.'
const missingProperty = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'
const missingLabel = 'Dieses Etikett gibt es nicht oder nicht mehr.'
const blockedIsNotPrinted = 'Ein gesperrtes Etikett wird nicht mehr gedruckt.'
const madeMeanwhile =
  'Währenddessen hat jemand anderes ein Etikett angelegt. Bitte noch einmal drucken.'

/** What a label hangs on, as the routes of an asset and of a room share them. */
interface Holder {
  readonly table: PgTable & { id: PgColumn; deletedAt: PgColumn }
  /** The column of the label that names it. */
  readonly column: PgColumn
  readonly key: 'assetId' | 'roomId'
  readonly missing: string
  /** What is said when a second valid label is asked for. */
  readonly taken: string
}

const onAsset: Holder = {
  table: assets,
  column: labels.assetId,
  key: 'assetId',
  missing: missingAsset,
  taken: 'Diese Anlage hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
}

const onRoom: Holder = {
  table: rooms,
  column: labels.roomId,
  key: 'roomId',
  missing: missingRoom,
  taken: 'Dieser Raum hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
}

/** The answer of a route, as far as a print writes into it. */
interface Response {
  setHeader(name: string, value: string): unknown
}

/** A row a label hangs on: where it lies is where its label lies. */
interface Placed {
  readonly id: string
  readonly propertyId: PropertyId
  readonly areaId: AreaId
}

/**
 * The asset or the room of an id, there for the person asking, and held
 * until the transaction ends: one removed meanwhile would otherwise keep a
 * label nothing takes away.
 */
async function heldFor<Row extends Placed>(
  tx: TenantTransaction,
  holder: Holder,
  id: string,
): Promise<Row> {
  if (!isUuid(id)) {
    throw new NotFoundException(holder.missing)
  }

  const [row] = await tx
    .select()
    .from(holder.table)
    .where(and(eq(holder.table.id, id), isNull(holder.table.deletedAt)))
    .for('share')

  if (row === undefined) {
    throw new NotFoundException(holder.missing)
  }

  return row as Row
}

/** A label of this asset or room that is not deleted, held for a change when `lock` says so. */
async function labelOn(
  tx: TenantTransaction,
  holder: Holder,
  holderId: string,
  id: string,
  lock: boolean,
): Promise<PlaceLabel> {
  if (!isUuid(id)) {
    throw new NotFoundException(missingLabel)
  }

  const query = tx
    .select()
    .from(labels)
    .where(and(eq(labels.id, id as LabelId), eq(holder.column, holderId), isNull(labels.deletedAt)))
  const [found] = lock ? await query.for('update') : await query

  if (found === undefined) {
    throw new NotFoundException(missingLabel)
  }

  return found as PlaceLabel
}

/** The format a request names, a label printer where it names none. */
function formatOf(value: unknown): LabelFormat {
  if (value === undefined || value === null || value === '' || value === 'roll') {
    return 'roll'
  }

  if (value === 'sheet') {
    return 'sheet'
  }

  throw new BadRequestException(
    'format ist roll für einen Etikettendrucker oder sheet für einen Bogen.',
  )
}

/** A whole number of a request, or NaN for anything else, which the check refuses. */
function whole(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Number.NaN
  }

  return typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN
}

/**
 * The same label as often as asked, and never more often than a print of one
 * label holds. The check of the print has refused a larger number before this
 * is reached; the bound stands here once more, where the list is made, so that
 * what a request names can never decide how much memory a print takes.
 */
function copiesOf(face: LabelFace, count: number): LabelFace[] {
  return Array.from({ length: Math.min(count, labelCountMax) }, () => face)
}

/** The body of a request as a record, whatever was sent. */
function saidIn(body: unknown): Readonly<Record<string, unknown>> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

/**
 * What the three controllers share: the address the instance is reached at,
 * which a label carries, and the way from the lines of labels to a PDF.
 */
abstract class LabelPrinting {
  constructor(
    protected readonly database: Database,
    protected readonly render: Renderer,
    protected readonly origins: readonly string[],
  ) {}

  /** The address a label leads to, or the sentence saying that the instance knows none. */
  protected origin(): string {
    const [origin] = this.origins

    if (!origin) {
      throw new ServiceUnavailableException(
        'Diese Instanz kennt ihre Adresse nicht, TRUSTED_ORIGINS ist leer. Ohne sie weiß ein Etikett nicht, wohin es führt.',
      )
    }

    return origin
  }

  /** Refuses a print the format cannot hold, before anything is read or made. */
  protected checked(format: LabelFormat, count: number, start: number, most?: number): void {
    const problem = labelPrintProblem(format, count, start, most)

    if (problem) {
      throw new UnprocessableEntityException(problem)
    }
  }

  /** The PDF of these labels, one field each, as the answer of a route. */
  protected async pdf(
    response: Response,
    faces: readonly LabelFace[],
    format: LabelFormat,
    start: number,
    title: string,
  ): Promise<StreamableFile> {
    const origin = this.origin()
    let bytes: Uint8Array

    try {
      bytes = await this.render(labelPrintJob({ labels: faces, origin, format, start, title }))
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="${title}.pdf"`,
      length: bytes.byteLength,
    })
  }

  /**
   * A new label on an asset or a room. Refused while that has a valid one: a
   * second would leave two stickers that open it, and blocking the one would
   * not block the other. Block first, then make the new one.
   */
  protected async make(identity: Asking, holder: Holder, holderId: string): Promise<PlaceLabel> {
    try {
      // Drawn by the server, and drawn again when the code stood there already.
      return await withLabelCode(labelCodeIndex, (draw) =>
        this.database.forTenant(identity, async (tx) => {
          const hung = await heldFor(tx, holder, holderId)
          const [valid] = await tx
            .select({ id: labels.id })
            .from(labels)
            .where(
              and(eq(holder.column, hung.id), isNull(labels.blockedAt), isNull(labels.deletedAt)),
            )

          if (valid) {
            throw new ConflictException(holder.taken)
          }

          const [created] = await tx
            .insert(labels)
            .values({
              tenantId: identity.tenantId,
              propertyId: hung.propertyId,
              areaId: hung.areaId,
              [holder.key]: hung.id,
              code: draw(),
            })
            .returning()

          return created as PlaceLabel
        }),
      )
    } catch (error) {
      // Two requests at once: the second finds the first one's label.
      if (oneValidLabelIndexes.some((index) => isUniqueViolation(error, index))) {
        throw new ConflictException(holder.taken)
      }

      if (error instanceof LabelCodeUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw error
    }
  }

  /**
   * Blocks a label for good: it opens nothing any more, on a device or in the
   * browser, for whoever asks, and is not printed again. Blocking one that is
   * blocked already answers with it as it is.
   */
  protected block(
    identity: Asking,
    holder: Holder,
    holderId: string,
    id: string,
  ): Promise<PlaceLabel> {
    return this.database.forTenant(identity, async (tx) => {
      const hung = await heldFor(tx, holder, holderId)
      const existing = await labelOn(tx, holder, hung.id, id, true)

      if (existing.blockedAt) {
        return existing
      }

      const [blocked] = await tx
        .update(labels)
        .set({ blockedAt: new Date() })
        .where(eq(labels.id, existing.id))
        .returning()

      return blocked as PlaceLabel
    })
  }

  /** What a request for the PDF of one label names: the format, the copies, the first field. */
  protected copies(
    formatParameter: unknown,
    countParameter: unknown,
    startParameter: unknown,
  ): { readonly format: LabelFormat; readonly count: number; readonly start: number } {
    const format = formatOf(formatParameter)
    const count = whole(countParameter, 1)
    const start = whole(startParameter, 1)

    this.checked(format, count, start)
    this.origin()

    return { format, count, start }
  }

  /**
   * The labels of these assets or rooms, one each: the valid one where there
   * is one, and a new one where there is none. In the order the rows come in.
   */
  protected async labelOfEach(
    tx: TenantTransaction,
    identity: Asking,
    draw: () => string,
    holder: Holder,
    rows: readonly Placed[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = rows.map((row) => row.id)
    const valid = await tx
      .select({ code: labels.code, holderId: holder.column })
      .from(labels)
      .where(and(inArray(holder.column, ids), isNull(labels.blockedAt), isNull(labels.deletedAt)))
    const codes = new Map(valid.map((label) => [String(label.holderId), label.code]))
    const without = rows.filter((row) => !codes.has(row.id))

    if (without.length > 0) {
      const made = await tx
        .insert(labels)
        .values(
          without.map((row) => ({
            tenantId: identity.tenantId,
            propertyId: row.propertyId,
            areaId: row.areaId,
            [holder.key]: row.id,
            code: draw(),
          })),
        )
        .returning({ code: labels.code, holderId: holder.column })

      for (const label of made) {
        codes.set(String(label.holderId), label.code)
      }
    }

    return codes
  }

  /**
   * Runs a print that makes labels: with codes drawn again when one stood
   * there already, and with the answers for two prints at once and for a
   * draw that found no free code.
   */
  protected async making<Written>(write: (draw: () => string) => Promise<Written>) {
    try {
      return await withLabelCode(labelCodeIndex, write)
    } catch (error) {
      if (oneValidLabelIndexes.some((index) => isUniqueViolation(error, index))) {
        throw new ConflictException(madeMeanwhile)
      }

      if (error instanceof LabelCodeUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw error
    }
  }
}

/**
 * The label of an asset: made and blocked by whoever takes assets into the
 * register (section 7 of the concept, "Anlagen aufnehmen"), printed by
 * whoever reads them.
 */
@Controller('assets/:assetId/labels')
export class AssetLabelsController extends LabelPrinting {
  constructor(
    database: Database,
    @Inject(RENDERER) render: Renderer,
    @Inject(TRUSTED_ORIGINS) origins: readonly string[],
  ) {
    super(database, render, origins)
  }

  @Post()
  @RequiresPermission('asset.record')
  create(@CurrentIdentity() identity: Asking, @Param('assetId') assetId: string) {
    return this.make(identity, onAsset, assetId)
  }

  @Post(':id/block')
  @HttpCode(200)
  @RequiresPermission('asset.record')
  blockOne(
    @CurrentIdentity() identity: Asking,
    @Param('assetId') assetId: string,
    @Param('id') id: string,
  ) {
    return this.block(identity, onAsset, assetId, id)
  }

  /**
   * The label as a PDF, `format` `roll` for a label printer or `sheet` for a
   * sheet A4, `count` copies from field `start` of the sheet.
   */
  @Get(':id/pdf')
  @RequiresPermission('asset.read')
  async print(
    @CurrentIdentity() identity: Asking,
    @Param('assetId') assetId: string,
    @Param('id') id: string,
    @Query('format') formatParameter: string | undefined,
    @Query('count') countParameter: string | undefined,
    @Query('start') startParameter: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { format, count, start } = this.copies(formatParameter, countParameter, startParameter)
    const face = await this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, assetId, missingAsset)
      const label = await labelOn(tx, onAsset, asset.id, id, false)

      if (label.blockedAt) {
        throw new ConflictException(blockedIsNotPrinted)
      }

      const faces = await assetFaces(tx, await keeperOf(tx), [asset])

      return { ...faces.get(asset.id), code: label.code } as LabelFace
    })

    return this.pdf(response, copiesOf(face, count), format, start, 'Etikett')
  }
}

/**
 * The label of a room, on its door: made and blocked by whoever takes rooms
 * into the register ("Räume aufnehmen"), printed by whoever sees the places.
 */
@Controller('rooms/:roomId/labels')
export class RoomLabelsController extends LabelPrinting {
  constructor(
    database: Database,
    @Inject(RENDERER) render: Renderer,
    @Inject(TRUSTED_ORIGINS) origins: readonly string[],
  ) {
    super(database, render, origins)
  }

  @Post()
  @RequiresPermission('room.record')
  create(@CurrentIdentity() identity: Asking, @Param('roomId') roomId: string) {
    return this.make(identity, onRoom, roomId)
  }

  @Post(':id/block')
  @HttpCode(200)
  @RequiresPermission('room.record')
  blockOne(
    @CurrentIdentity() identity: Asking,
    @Param('roomId') roomId: string,
    @Param('id') id: string,
  ) {
    return this.block(identity, onRoom, roomId, id)
  }

  @Get(':id/pdf')
  @RequiresPermission('location.read')
  async print(
    @CurrentIdentity() identity: Asking,
    @Param('roomId') roomId: string,
    @Param('id') id: string,
    @Query('format') formatParameter: string | undefined,
    @Query('count') countParameter: string | undefined,
    @Query('start') startParameter: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { format, count, start } = this.copies(formatParameter, countParameter, startParameter)
    const face = await this.database.forTenant(identity, async (tx) => {
      const room = await placeOf<Room>(tx, rooms, roomId, missingRoom)
      const label = await labelOn(tx, onRoom, room.id, id, false)

      if (label.blockedAt) {
        throw new ConflictException(blockedIsNotPrinted)
      }

      const faces = await roomFaces(tx, await keeperOf(tx), [room])

      return { ...faces.get(room.id), code: label.code } as LabelFace
    })

    return this.pdf(response, copiesOf(face, count), format, start, 'Etikett')
  }
}

/**
 * What a code is for the person asking, and the prints of many different
 * labels at once: for the assets a register lists, for the rooms of a
 * building, and a sheet of labels that hang on nothing yet.
 */
@Controller('labels')
export class LabelsController extends LabelPrinting {
  constructor(
    database: Database,
    @Inject(RENDERER) render: Renderer,
    @Inject(TRUSTED_ORIGINS) origins: readonly string[],
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {
    super(database, render, origins)
  }

  /**
   * What a print of many labels names beside its labels: the format and the
   * first field. Checked before a label is made, so that a print refused over
   * its format leaves nothing behind; how many there are is checked where
   * they are counted.
   */
  private sheet(body: Readonly<Record<string, unknown>>, count = 1) {
    const format = formatOf(body['format'])
    const start = whole(body['start'], 1)

    this.checked(format, count, start, labelBatchMost)
    this.origin()

    return { format, start }
  }

  /**
   * A label for every asset the register lists under a filter, the one it has
   * or a new one, each once, in the order of the register. The filter is the
   * one of `GET /assets`, without a page: what is printed is what the list
   * shows, in the areas of the person asking.
   *
   * It makes labels, so it asks for the right that making one asks for.
   */
  @Post('print/assets')
  @HttpCode(200)
  @RequiresPermission('asset.record')
  async printAssets(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const said = saidIn(body)
    const { filter } = registerQuestion(saidIn(said['filter']))
    const { format, start } = this.sheet(said)
    const faces = await this.making((draw) =>
      this.database.forTenant(identity, async (tx) => {
        const listed = await assetRegister(tx, this.catalogue, dayInGermany(), {
          filter,
          offset: 0,
          limit: labelBatchMost,
        })

        if (listed.total === 0) {
          throw new UnprocessableEntityException(
            'Die Liste ist leer, es gibt kein Etikett zu drucken.',
          )
        }

        if (listed.total > labelBatchMost) {
          throw new UnprocessableEntityException(
            `Die Liste nennt ${String(listed.total)} Anlagen. Gedruckt werden höchstens ${String(labelBatchMost)} Etiketten auf einmal, die Liste lässt sich im Verzeichnis eingrenzen.`,
          )
        }

        const ids = listed.assets.map((entry) => entry.id)
        const rows = (await tx
          .select()
          .from(assets)
          .where(and(inArray(assets.id, ids), isNull(assets.deletedAt)))
          .for('share')) as Asset[]
        const byId = new Map(rows.map((row) => [row.id, row]))
        const inOrder = ids.map((id) => byId.get(id)).filter((row) => row !== undefined)
        const codes = await this.labelOfEach(tx, identity, draw, onAsset, inOrder)
        const lines = await assetFaces(tx, await keeperOf(tx), inOrder)

        return inOrder.map(
          (asset) =>
            ({ ...lines.get(asset.id), code: codes.get(asset.id) }) as unknown as LabelFace,
        )
      }),
    )

    return this.pdf(response, faces, format, start, 'Etiketten')
  }

  /**
   * A label for every room of a building, for its door: the one the room has
   * or a new one, floor by floor and by number.
   */
  @Post('print/rooms')
  @HttpCode(200)
  @RequiresPermission('room.record')
  async printRooms(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const said = saidIn(body)
    const { format, start } = this.sheet(said)
    const faces = await this.making((draw) =>
      this.database.forTenant(identity, async (tx) => {
        const building = await placeOf<Building>(
          tx,
          buildings,
          String(said['buildingId'] ?? ''),
          missingBuilding,
        )
        const found = await tx
          .select({ room: rooms })
          .from(rooms)
          .innerJoin(floors, eq(floors.id, rooms.floorId))
          .where(and(eq(rooms.buildingId, building.id as BuildingId), isNull(rooms.deletedAt)))
          .orderBy(asc(floors.level), asc(rooms.number), asc(rooms.name), asc(rooms.id))
          .for('share', { of: rooms })
        const inOrder = found.map((row) => row.room as Room)

        if (inOrder.length === 0) {
          throw new UnprocessableEntityException(
            'Dieses Gebäude hat noch keine Räume, es gibt kein Etikett zu drucken.',
          )
        }

        if (inOrder.length > labelBatchMost) {
          throw new UnprocessableEntityException(
            `Dieses Gebäude hat ${String(inOrder.length)} Räume. Gedruckt werden höchstens ${String(labelBatchMost)} Etiketten auf einmal.`,
          )
        }

        const codes = await this.labelOfEach(tx, identity, draw, onRoom, inOrder)
        const lines = await roomFaces(tx, await keeperOf(tx), inOrder)

        return inOrder.map(
          (room) => ({ ...lines.get(room.id), code: codes.get(room.id) }) as unknown as LabelFace,
        )
      }),
    )

    return this.pdf(response, faces, format, start, 'Etiketten')
  }

  /**
   * A sheet of labels that hang on nothing yet, for taking stock: each with
   * a code of its own, in the property named, to be given to an asset on
   * site. New labels on every print: one that was never stuck on anything is
   * not worth finding again.
   */
  @Post('print/blank')
  @HttpCode(200)
  @RequiresPermission('asset.record')
  async printBlank(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const said = saidIn(body)
    const count = whole(said['count'], 24)
    const { format, start } = this.sheet(said, count)
    const faces = await this.making((draw) =>
      this.database.forTenant(identity, async (tx) => {
        const property = await placeOf<Property>(
          tx,
          properties,
          String(said['propertyId'] ?? ''),
          missingProperty,
        )
        const made = await tx
          .insert(labels)
          .values(
            // Bounded where the rows are made, as `copiesOf` is.
            Array.from({ length: Math.min(count, labelBatchMost) }, () => ({
              tenantId: identity.tenantId,
              propertyId: property.id,
              areaId: property.areaId,
              code: draw(),
            })),
          )
          .returning({ code: labels.code })
        const line = blankFace(await keeperOf(tx), property)

        return made.map((label): LabelFace => ({ ...line, code: label.code }))
      }),
    )

    return this.pdf(response, faces, format, start, 'Etiketten')
  }

  /**
   * What a code is for the person asking, in one word, and nothing else: no
   * asset, no room, no property and no id (section 2.8 of the concept, board
   * "Etikett gesperrt, fremd, außerhalb"). A device asks when it holds no
   * label with the code.
   *
   * First under the policies of the person: a label they see is `open`, or
   * `blocked` when it opens nothing any more. A code they do not see is asked
   * past their areas, of the one function that may, which says whether the
   * operator has such a label at all: `outside` then, or `blocked`, and
   * `unknown` for everything else, a label of another operator included.
   */
  @Get(':code')
  @RequiresPermission('asset.read')
  standing(
    @CurrentIdentity() identity: Asking,
    @Param('code') code: string,
  ): Promise<LabelStandingAnswer> {
    if (!isLabelCode(code)) {
      return Promise.resolve({ standing: 'unknown' })
    }

    return this.database.forTenant(identity, async (tx): Promise<LabelStandingAnswer> => {
      const [seen] = await tx
        .select({ blockedAt: labels.blockedAt, deletedAt: labels.deletedAt })
        .from(labels)
        .where(eq(labels.code, code))

      if (seen) {
        return { standing: seen.blockedAt === null && seen.deletedAt === null ? 'open' : 'blocked' }
      }

      const { rows } = await tx.execute<{ state: string | null }>(
        sql`select label_state_in_tenant(${code}) as state`,
      )
      const state = rows[0]?.state

      return {
        standing: state === 'valid' ? 'outside' : state === 'blocked' ? 'blocked' : 'unknown',
      }
    })
  }
}
