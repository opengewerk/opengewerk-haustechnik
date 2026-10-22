import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type Asset,
  type BuildingId,
  type DefectId,
  type FaultCategory,
  faultCategoryProblems,
  type FaultReportSettings,
  faultReportSettingsProblems,
  faultInboxFilters,
  type FaultInboxFilter,
  type FaultLabelAnswer,
  type FaultPlaceChoice,
  faultRejectionProblems,
  type FaultReportEntry,
  type FaultReportId,
  type FaultReportPage,
  faultPlaceLine,
  faultReportProblems,
  faultReportStateLabel,
  fileHashProblem,
  fileSizeProblem,
  isAllowed,
  isLabelCode,
  largestFileBytes,
  mergeProblem,
  missingRight,
  type OwnFaultReport,
  type Room,
  type RoomId,
  type AssetId,
} from '@opengewerk/haustechnik-domain'
import {
  AcceptsBody,
  bodyBytesOf,
  CurrentIdentity,
  Database,
  FILE_STORE,
  type FileStorage,
  fileRowFor,
  fileUploadType,
  isUuid,
  mayNameFile,
  storedMediaType,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
  UploadLimits,
} from '@opengewerk/platform-server'
import { and, eq, isNull, ne, type SQL, sql } from 'drizzle-orm'

import { files } from '@opengewerk/platform-server/schema'

import {
  assets,
  buildings,
  defects,
  faultCategories,
  faultReportContacts,
  faultReportSettings,
  faultReports,
  labels,
  rooms,
} from '../database/schema/index.js'
import {
  categoriesOf,
  ensureCategories,
  faultReportSettingsOf,
  entryOf,
  type FaultRow,
  inbox,
  ownOf,
  placeChoices,
  rowOf,
  rowsWhere,
  stateOf,
} from '../faults/reading.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, changedInEveryArea, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diese Störmeldung gibt es nicht oder nicht in Ihren Bereichen.'
const missingCategory = 'Diese Kategorie gibt es nicht oder nicht mehr.'

/** The request a body is read from, as the foundation reads it. */
type BodyRequest = Parameters<typeof bodyBytesOf>[0]

type ReportId = (typeof faultReports.$inferSelect)['id']
type CategoryId = (typeof faultCategories.$inferSelect)['id']
type BuildingRowId = (typeof buildings.$inferSelect)['id']

/** The kinds of picture a photo of a report may be; anything else is refused before it is stored. */
const photoTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const

/**
 * How near another report of the building is to this one, smaller is nearer:
 * the same asset, then the same room, then the rest; the same category first
 * within each. The nearest is the one the merge dialog offers first.
 */
function closeness(report: FaultReportEntry, other: FaultReportEntry): number {
  const place =
    report.assetId !== null && other.assetId === report.assetId
      ? 0
      : report.roomId !== null && other.roomId === report.roomId
        ? 2
        : 4

  return place + (other.category === report.category ? 0 : 1)
}

/** A query value as one text, or nothing. */
function one(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A report the person asking sees, held until the transaction ends, so that two decisions on it come one after the other. */
async function heldRow(tx: TenantTransaction, id: string): Promise<FaultRow> {
  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  await tx
    .select({ id: faultReports.id })
    .from(faultReports)
    .where(eq(faultReports.id, id as ReportId))
    .for('update')

  const row = await rowOf(tx, id)

  if (row === null) {
    throw new NotFoundException(missing)
  }

  return row
}

/** The bytes of the photo of a report, or a 404 that says nothing about the report. */
async function photoOf(tx: TenantTransaction, sha256: string | null) {
  if (sha256 === null) {
    throw new NotFoundException('Zu dieser Meldung gibt es kein Foto.')
  }

  const [file] = await tx
    .select({ sha256: files.sha256, mediaType: files.mediaType })
    .from(files)
    .where(eq(files.sha256, sha256))

  if (!file) {
    throw new NotFoundException('Zu dieser Meldung gibt es kein Foto.')
  }

  return file
}

function photoAnswer(bytes: Uint8Array, mediaType: string): StreamableFile {
  return new StreamableFile(Buffer.from(bytes), {
    type: mediaType,
    disposition: 'inline',
    length: bytes.byteLength,
  })
}

/**
 * The fault reports (#331, section 4.7 of the concept).
 *
 * Reporting is "Störungen melden": a person reports at a building, a room or
 * an asset of the own areas and sees the own reports with their state and
 * nothing behind them. The Melder has no other right and its device holds
 * nothing, so the buildings and rooms to choose from and what a scanned label
 * stands for are answered here, by their names only.
 *
 * The inbox is "Störungen annehmen": the reports of the own areas, without the
 * person who reported them, which stands in the change log. Accepting one is
 * making a work order from it (`POST /work-orders` with the origin `fault`);
 * here it is merged into another of the same building or rejected with the
 * reason, and a defect is reported from it.
 *
 * The routes without a parameter come before `:id`, which would take them.
 */
@Controller('fault-reports')
export class FaultReportsController {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
    private readonly limits: UploadLimits,
  ) {}

  /** The categories to choose from, the proposal of the first start written once. */
  @Get('categories')
  @RequiresPermission('fault.report')
  categories(@CurrentIdentity() identity: Asking): Promise<readonly FaultCategory[]> {
    return this.database.forTenant(identity, async (tx) => {
      await ensureCategories(tx, identity.tenantId)

      return categoriesOf(tx)
    })
  }

  /** The buildings and rooms of the own areas, by their names only. */
  @Get('places')
  @RequiresPermission('fault.report')
  places(@CurrentIdentity() identity: Asking): Promise<readonly FaultPlaceChoice[]> {
    return this.database.forTenant(identity, (tx) => placeChoices(tx))
  }

  /**
   * What a scanned label stands for, to somebody who reports: the building and
   * the room of a room or an asset of the own areas, by their names, and the
   * ids to report with. An asset is named by the room it stands in, never by
   * itself. Every other case is the word the scan of every role gets.
   */
  @Get('label/:code')
  @RequiresPermission('fault.report')
  label(
    @CurrentIdentity() identity: Asking,
    @Param('code') code: string,
  ): Promise<FaultLabelAnswer> {
    if (!isLabelCode(code)) {
      return Promise.resolve({ standing: 'unknown' })
    }

    return this.database.forTenant(identity, async (tx): Promise<FaultLabelAnswer> => {
      const [seen] = await tx
        .select({
          assetId: labels.assetId,
          roomId: labels.roomId,
          blockedAt: labels.blockedAt,
          deletedAt: labels.deletedAt,
        })
        .from(labels)
        .where(eq(labels.code, code))

      if (seen === undefined) {
        const { rows } = await tx.execute<{ state: string | null }>(
          sql`select label_state_in_tenant(${code}) as state`,
        )
        const state = rows[0]?.state

        return {
          standing: state === 'valid' ? 'outside' : state === 'blocked' ? 'blocked' : 'unknown',
        }
      }

      if (seen.blockedAt !== null || seen.deletedAt !== null) {
        return { standing: 'blocked' }
      }

      let place: { buildingId: BuildingId; roomId: RoomId | null; assetId: AssetId | null } | null =
        null

      if (seen.assetId !== null) {
        const [asset] = await tx
          .select({ buildingId: assets.buildingId, roomId: assets.roomId })
          .from(assets)
          .where(and(eq(assets.id, seen.assetId), isNull(assets.deletedAt)))

        place = asset
          ? {
              buildingId: asset.buildingId as BuildingId,
              roomId: null,
              assetId: seen.assetId as AssetId,
            }
          : null
      } else if (seen.roomId !== null) {
        const [room] = await tx
          .select({ buildingId: rooms.buildingId })
          .from(rooms)
          .where(and(eq(rooms.id, seen.roomId), isNull(rooms.deletedAt)))

        place = room
          ? {
              buildingId: room.buildingId as BuildingId,
              roomId: seen.roomId as RoomId,
              assetId: null,
            }
          : null
      }

      if (place === null) {
        return { standing: 'unassigned' }
      }

      return { standing: 'open', place, words: await this.wordsAt(tx, place) }
    })
  }

  /** The names of a place as a person who reports sees them: building and room, the room of an asset. */
  private async wordsAt(
    tx: TenantTransaction,
    place: { buildingId: string; roomId: string | null; assetId: string | null },
  ) {
    const [found] = await tx
      .execute<{ property: string; building: string; number: string | null; name: string | null }>(
        sql`
      select p.name as property, b.name as building, r.number as number, r.name as name
        from buildings b
        join properties p on p.id = b.property_id
        left join assets a on a.id = ${place.assetId}
        left join rooms r on r.id = coalesce(${place.roomId}::uuid, a.room_id)
       where b.id = ${place.buildingId}`,
      )
      .then((result) => result.rows)

    if (found === undefined) {
      throw new NotFoundException('Diesen Ort gibt es nicht oder nicht in Ihren Bereichen.')
    }

    const room =
      found.number === null && found.name === null
        ? null
        : [found.number, found.name].filter(Boolean).join(' ')

    return { property: found.property, building: found.building, room }
  }

  /**
   * The bytes of the photo of a report, sent ahead of the report as the file
   * store of the foundation takes them, under the right to report: a Melder
   * files no document and so may not use that route. Only a picture is taken.
   */
  @Put('photos/:sha256')
  @RequiresPermission('fault.report')
  @AcceptsBody(
    [fileUploadType],
    'Ein Foto wird als application/octet-stream geschickt, mit seinem Typ im Kopf X-Media-Type.',
  )
  async photo(
    @CurrentIdentity() identity: Asking,
    @Param('sha256') sha256: string,
    @Req() request: BodyRequest,
  ): Promise<{ readonly sha256: string; readonly mediaType: string }> {
    const malformed = fileHashProblem(sha256)

    if (malformed) {
      throw new BadRequestException(malformed)
    }

    const body = await bodyBytesOf(request, largestFileBytes)

    if (body === null) {
      throw new PayloadTooLargeException(fileSizeProblem(largestFileBytes + 1) ?? undefined)
    }

    const empty = fileSizeProblem(body.byteLength)

    if (empty) {
      throw new BadRequestException(empty)
    }

    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new UnprocessableEntityException(
        'Der Inhalt passt nicht zu seiner Prüfsumme. Das Foto ist unterwegs beschädigt worden; schicken Sie es noch einmal.',
      )
    }

    const mediaType = storedMediaType(bytes, request.header('x-media-type') ?? '')

    if (!(photoTypes as readonly string[]).includes(mediaType)) {
      throw new BadRequestException(
        'Zu einer Störung gehört ein Foto, also ein Bild als JPEG, PNG, WebP oder HEIC.',
      )
    }

    // As much as an hour allows the account and the operator, and room left
    // on the volume (#360): counted only for a photo that is one.
    await this.limits.admit(identity, bytes.byteLength)

    const blob = await this.store.put(bytes)

    return this.database.forTenant(identity, async (tx) => {
      await fileRowFor(tx, identity.tenantId, blob, mediaType)

      return { sha256: blob.sha256, mediaType }
    })
  }

  /**
   * A new report: a category still offered, the description, exactly one of
   * a building, a room or an asset of the own areas, and a photo stored
   * before. The building and the area come from the place; who reported is
   * the person asking.
   */
  @Post()
  @RequiresPermission('fault.report')
  report(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ readonly id: FaultReportId }> {
    const values = fieldsOf(
      body,
      ['categoryId', 'description', 'buildingId', 'roomId', 'assetId', 'photoSha256'],
      ['buildingId', 'roomId', 'assetId', 'photoSha256'],
    )

    refuse(faultReportProblems(values))

    if (!isUuid(String(values.categoryId))) {
      throw new BadRequestException(missingCategory)
    }

    return this.database.forTenant(identity, async (tx) => {
      const [category] = await tx
        .select({ id: faultCategories.id })
        .from(faultCategories)
        .where(
          and(
            eq(faultCategories.id, String(values.categoryId) as CategoryId),
            isNull(faultCategories.removedAt),
          ),
        )

      if (category === undefined) {
        throw new BadRequestException(missingCategory)
      }

      const place = await this.placeFor(tx, values)
      const photo = values.photoSha256 ?? null

      if (photo !== null) {
        const [file] = await tx
          .select({ mediaType: files.mediaType })
          .from(files)
          .where(eq(files.sha256, String(photo)))

        // The photo of a report is one the person sent themselves (#360): a
        // hash of a file of another area is answered like one never sent.
        if (
          file === undefined ||
          !(photoTypes as readonly string[]).includes(file.mediaType) ||
          !(await mayNameFile(tx, String(photo)))
        ) {
          throw new BadRequestException(
            'Das Foto ist nicht angekommen. Nehmen Sie es noch einmal auf.',
          )
        }
      }

      const [made] = await tx
        .insert(faultReports)
        .values({
          tenantId: identity.tenantId,
          ...place,
          categoryId: category.id,
          description: String(values.description),
          photoSha256: photo === null ? null : String(photo),
          reportedBy: identity.userId,
        })
        .returning({ id: faultReports.id })

      if (made === undefined) {
        throw new Error('The fault report was not written')
      }

      return { id: made.id as FaultReportId }
    })
  }

  /** The place of a new report, from the one id the body names, under the policies of the person asking. */
  private async placeFor(tx: TenantTransaction, values: Readonly<Record<string, unknown>>) {
    if (values['assetId'] !== undefined && values['assetId'] !== null) {
      const asset = await placeOf<Asset>(
        tx,
        assets,
        String(values['assetId']),
        'Diese Anlage gibt es nicht oder nicht in Ihren Bereichen.',
      )

      return {
        propertyId: asset.propertyId,
        areaId: asset.areaId,
        buildingId: asset.buildingId,
        roomId: null,
        assetId: asset.id,
      }
    }

    if (values['roomId'] !== undefined && values['roomId'] !== null) {
      const room = await placeOf<Room & { buildingId: BuildingId }>(
        tx,
        rooms,
        String(values['roomId']),
        'Diesen Raum gibt es nicht oder nicht in Ihren Bereichen.',
      )

      return {
        propertyId: room.propertyId,
        areaId: room.areaId,
        buildingId: room.buildingId,
        roomId: room.id,
        assetId: null,
      }
    }

    const missingBuilding = 'Dieses Gebäude gibt es nicht oder nicht in Ihren Bereichen.'

    if (!isUuid(String(values['buildingId']))) {
      throw new NotFoundException(missingBuilding)
    }

    const [building] = await tx
      .select({ id: buildings.id, propertyId: buildings.propertyId, areaId: buildings.areaId })
      .from(buildings)
      .where(
        and(
          eq(buildings.id, String(values['buildingId']) as BuildingRowId),
          isNull(buildings.deletedAt),
        ),
      )

    if (building === undefined) {
      throw new NotFoundException(missingBuilding)
    }

    return {
      propertyId: building.propertyId,
      areaId: building.areaId,
      buildingId: building.id,
      roomId: null,
      assetId: null,
    }
  }

  /**
   * The own reports, the newest first, with their state and nothing behind
   * them: no work order, no person and no asset. Only those the person asking
   * reported, whatever other rights they hold.
   */
  @Get('mine')
  @RequiresPermission('fault.report')
  mine(@CurrentIdentity() identity: Asking): Promise<readonly OwnFaultReport[]> {
    return this.database.forTenant(identity, async (tx) => {
      const rows = await rowsWhere(tx, eq(faultReports.reportedBy, identity.userId)).limit(200)

      return Promise.all(rows.map((row) => ownOf(tx, row)))
    })
  }

  /** The photo of an own report. */
  @Get('mine/:id/photo')
  @RequiresPermission('fault.report')
  @Header('Cache-Control', 'private, no-store')
  async ownPhoto(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const file = await this.database.forTenant(identity, async (tx) => {
      const row = isUuid(id) ? await rowOf(tx, id) : null

      if (row === null || row.report.reportedBy !== identity.userId) {
        throw new NotFoundException(missing)
      }

      return photoOf(tx, row.report.photoSha256)
    })

    return photoAnswer(await this.store.get(file.sha256), file.mediaType)
  }

  /** The inbox of the own areas, narrowed by state (`?state=`, received by default) and by place or category. */
  @Get()
  @RequiresPermission('fault.accept')
  list(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<readonly FaultReportEntry[]> {
    const state = one(query['state']) ?? 'received'

    if (!(faultInboxFilters as readonly string[]).includes(state)) {
      throw new BadRequestException(
        'Der Stand ist einer von: eingegangen, angenommen, erledigt, abgelehnt oder alle.',
      )
    }

    const ids = ['propertyId', 'buildingId', 'assetId', 'areaId', 'categoryId'] as const
    const narrowed: Partial<Record<(typeof ids)[number], string>> = {}

    for (const key of ids) {
      const value = one(query[key])

      if (value !== undefined) {
        if (!isUuid(value)) {
          return Promise.resolve([])
        }

        narrowed[key] = value
      }
    }

    return this.database.forTenant(identity, (tx) =>
      inbox(tx, { filter: state as FaultInboxFilter, ...narrowed }),
    )
  }

  /**
   * The inbox as a table, with what its filter shows (section 3 of the
   * concept, #527), from the areas of the person. A report in the inbox names
   * nobody (4.7), and so does its table: no person who reported, no address
   * for an answer.
   */
  @Get('table')
  @RequiresPermission('fault.accept')
  @Header('Cache-Control', 'no-store')
  async table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const entries = await this.list(identity, query)

    return tableAnswer(
      {
        name: 'Störungen',
        columns: [
          'Eingegangen',
          'Kategorie',
          'Ort',
          'Anlage',
          'Beschreibung',
          'Stand',
          'Auftrag',
          'Ohne Konto',
        ],
        rows: entries.map((entry) => [
          dayInGermany(new Date(entry.receivedAt)),
          entry.category,
          faultPlaceLine(entry.words),
          entry.assetName ?? '',
          entry.description,
          faultReportStateLabel[entry.state],
          entry.workOrder?.number ?? '',
          entry.outside ? 'ja' : 'nein',
        ]),
      },
      format,
      dayInGermany(),
    )
  }

  /** The page of a report: the entry, what went into it, what it may be merged with, its order and its defect. */
  @Get(':id')
  @RequiresPermission('fault.accept')
  page(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<FaultReportPage> {
    return this.database.forTenant(identity, (tx) => this.read(tx, id))
  }

  private async read(tx: TenantTransaction, id: string): Promise<FaultReportPage> {
    const row = isUuid(id) ? await rowOf(tx, id) : null

    if (row === null) {
      throw new NotFoundException(missing)
    }

    const entry = entryOf(row)
    const into = row.report.mergedIntoId === null ? null : await rowOf(tx, row.report.mergedIntoId)
    const merged = await rowsWhere(tx, eq(faultReports.mergedIntoId, row.report.id))
    const similar =
      entry.state === 'received'
        ? (
            await rowsWhere(
              tx,
              and(
                eq(faultReports.buildingId, row.report.buildingId),
                ne(faultReports.id, row.report.id),
                isNull(faultReports.mergedIntoId),
                isNull(faultReports.rejectedAt),
              ) as SQL,
            ).limit(50)
          )
            .map(entryOf)
            .filter((other) => other.state === 'received' || other.state === 'accepted')
            .sort(
              (a, b) =>
                closeness(entry, a) - closeness(entry, b) ||
                b.receivedAt.localeCompare(a.receivedAt),
            )
        : []

    return {
      ...entry,
      hasPhoto: row.report.photoSha256 !== null,
      acceptedAt: row.report.acceptedAt?.toISOString() ?? null,
      rejectedAt: row.report.rejectedAt?.toISOString() ?? null,
      rejectionReason: row.report.rejectionReason,
      mergedInto: into === null ? null : entryOf(into),
      merged: merged.map(entryOf),
      similar,
      workOrderTitle: entry.workOrder === null ? null : row.orderTitle,
      defectId: row.report.defectId,
      // Whether an answer by mail waits, and never to whom (#332).
      answersByMail:
        (
          await tx
            .select({ id: faultReportContacts.id })
            .from(faultReportContacts)
            .where(eq(faultReportContacts.faultReportId, row.report.id))
        ).length > 0,
    }
  }

  /** The photo of a report in the inbox. */
  @Get(':id/photo')
  @RequiresPermission('fault.accept')
  @Header('Cache-Control', 'private, no-store')
  async inboxPhoto(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const file = await this.database.forTenant(identity, async (tx) => {
      const row = isUuid(id) ? await rowOf(tx, id) : null

      if (row === null) {
        throw new NotFoundException(missing)
      }

      return photoOf(tx, row.report.photoSha256)
    })

    return photoAnswer(await this.store.get(file.sha256), file.mediaType)
  }

  /**
   * Merging (section 4.7 of the concept): a report still in the inbox goes
   * into another of the same building that is in the inbox or accepted. What
   * went into this one goes along, so that no report follows one that follows
   * another.
   */
  @Post(':id/merge')
  @RequiresPermission('fault.accept')
  merge(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<FaultReportPage> {
    const { intoId } = fieldsOf(body, ['intoId'])

    if (typeof intoId !== 'string' || !isUuid(intoId)) {
      throw new BadRequestException('Zusammengeführt wird mit einer Meldung desselben Gebäudes.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const row = await heldRow(tx, id)
      const into = await heldRow(tx, intoId)
      const problem = mergeProblem(
        { id: row.report.id, buildingOf: row.report.buildingId, state: stateOf(row) },
        { id: into.report.id, buildingOf: into.report.buildingId, state: stateOf(into) },
      )

      if (problem !== null) {
        throw new ConflictException(problem)
      }

      // A report back in the inbox after its order was not performed leaves that order behind.
      await tx
        .update(faultReports)
        .set({
          mergedIntoId: into.report.id,
          workOrderId: null,
          acceptedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(faultReports.id, row.report.id))
      await tx
        .update(faultReports)
        .set({ mergedIntoId: into.report.id, updatedAt: new Date() })
        .where(eq(faultReports.mergedIntoId, row.report.id))

      return this.read(tx, row.report.id)
    })
  }

  /**
   * Rejecting with the reason, which the person who reported reads in the own
   * list. Only a report still in the inbox; it is not opened again.
   */
  @Post(':id/reject')
  @RequiresPermission('fault.accept')
  reject(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<FaultReportPage> {
    const values = fieldsOf(body, ['reason'])

    refuse(faultRejectionProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const row = await heldRow(tx, id)

      if (stateOf(row) !== 'received') {
        throw new ConflictException('Abgelehnt wird eine Meldung, die noch im Eingang steht.')
      }

      await tx
        .update(faultReports)
        .set({
          rejectedAt: new Date(),
          rejectionReason: String(values.reason),
          workOrderId: null,
          acceptedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(faultReports.id, row.report.id))

      return this.read(tx, row.report.id)
    })
  }

  /**
   * A defect reported from a report (section 4.6 of the concept): at the
   * place of the report, with what was reported, found today and without a
   * class, which whoever keeps defects gives it. Its photo is not copied: it
   * stays with the report, which the defect names as its origin. Once per
   * report.
   */
  @Post(':id/defect')
  @RequiresPermission('fault.accept')
  defect(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<{ readonly defectId: DefectId }> {
    if (!isAllowed(identity, 'defect.report')) {
      throw new ForbiddenException(missingRight('defect.report'))
    }

    return this.database.forTenant(identity, async (tx) => {
      const row = await heldRow(tx, id)

      if (row.report.defectId !== null) {
        throw new ConflictException('Aus dieser Meldung ist schon ein Mangel gemeldet.')
      }

      const atAsset = row.report.assetId !== null
      const atRoom = !atAsset && row.report.roomId !== null
      const [made] = await tx
        .insert(defects)
        .values({
          tenantId: identity.tenantId,
          propertyId: row.report.propertyId,
          areaId: row.report.areaId,
          buildingId: atAsset || atRoom ? null : row.report.buildingId,
          roomId: atRoom ? row.report.roomId : null,
          assetId: atAsset ? row.report.assetId : null,
          description: row.report.description.slice(0, 1000),
          foundOn: dayInGermany(),
        })
        .returning({ id: defects.id })

      if (made === undefined) {
        throw new Error('The defect was not written')
      }

      await tx
        .update(faultReports)
        .set({ defectId: made.id, updatedAt: new Date() })
        .where(eq(faultReports.id, row.report.id))

      return { defectId: made.id as DefectId }
    })
  }
}

/**
 * The categories of the fault reports under "Einstellungen" (decided
 * 15.10.2026): whoever changes settings renames, adds and removes them; a
 * removed one is marked and stays at the reports that carry it.
 */
@Controller('settings/fault-categories')
export class FaultCategorySettingsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  list(@CurrentIdentity() identity: Asking): Promise<readonly FaultCategory[]> {
    return this.database.forTenant(identity, async (tx) => {
      await ensureCategories(tx, identity.tenantId)

      return categoriesOf(tx, true)
    })
  }

  @Post()
  @RequiresPermission('settings.write')
  add(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<readonly FaultCategory[]> {
    const values = fieldsOf(body, ['name'])

    refuse(faultCategoryProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      await changedInEveryArea(tx)

      await ensureCategories(tx, identity.tenantId)
      await this.refuseTwice(tx, String(values.name), null)

      const [last] = await tx
        .select({ most: sql<number>`coalesce(max(${faultCategories.position}), -1)` })
        .from(faultCategories)

      await tx.insert(faultCategories).values({
        tenantId: identity.tenantId,
        name: String(values.name),
        position: Number(last?.most ?? -1) + 1,
      })

      return categoriesOf(tx, true)
    })
  }

  @Put(':id')
  @RequiresPermission('settings.write')
  rename(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<readonly FaultCategory[]> {
    const values = fieldsOf(body, ['name'])

    refuse(faultCategoryProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      await changedInEveryArea(tx)

      await this.held(tx, id)
      await this.refuseTwice(tx, String(values.name), id)
      await tx
        .update(faultCategories)
        .set({ name: String(values.name), updatedAt: new Date() })
        .where(eq(faultCategories.id, id as CategoryId))

      return categoriesOf(tx, true)
    })
  }

  /** Removing a category: marked, no longer offered, kept at its reports. The last one stays. */
  @Delete(':id')
  @RequiresPermission('settings.write')
  remove(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<readonly FaultCategory[]> {
    return this.database.forTenant(identity, async (tx) => {
      await changedInEveryArea(tx)

      await this.held(tx, id)

      if ((await categoriesOf(tx)).length <= 1) {
        throw new ConflictException('Eine Kategorie bleibt, damit sich eine Störung melden lässt.')
      }

      await tx
        .update(faultCategories)
        .set({ removedAt: new Date(), updatedAt: new Date() })
        .where(eq(faultCategories.id, id as CategoryId))

      return categoriesOf(tx, true)
    })
  }

  private async held(tx: TenantTransaction, id: string): Promise<void> {
    if (!isUuid(id)) {
      throw new NotFoundException(missingCategory)
    }

    const [found] = await tx
      .select({ id: faultCategories.id })
      .from(faultCategories)
      .where(and(eq(faultCategories.id, id as CategoryId), isNull(faultCategories.removedAt)))
      .for('update')

    if (found === undefined) {
      throw new NotFoundException(missingCategory)
    }
  }

  /** Two categories offered under one name would be one choice twice. */
  private async refuseTwice(
    tx: TenantTransaction,
    name: string,
    except: string | null,
  ): Promise<void> {
    const [same] = await tx
      .select({ id: faultCategories.id })
      .from(faultCategories)
      .where(
        and(
          isNull(faultCategories.removedAt),
          sql`lower(${faultCategories.name}) = lower(${name})`,
          except === null ? undefined : ne(faultCategories.id, except as CategoryId),
        ),
      )

    if (same !== undefined) {
      throw new ConflictException('Eine Kategorie mit diesem Namen gibt es schon.')
    }
  }
}

/**
 * What an operator sets for its fault reports under "Einstellungen" (section
 * 4.7 of the concept, #332): whether the label at a room or an asset takes a
 * report from somebody without an account. Shipped off; the Leitung switches
 * it on, as seeing and changing the settings is what section 7 gives to it.
 */
@Controller('settings/fault-reports')
export class FaultReportSettingsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  read(@CurrentIdentity() identity: Asking): Promise<FaultReportSettings> {
    return this.database.forTenant(identity, (tx) => faultReportSettingsOf(tx))
  }

  @Put()
  @RequiresPermission('settings.write')
  set(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<FaultReportSettings> {
    const values = fieldsOf(body, ['openByLabel'], [])

    refuse(faultReportSettingsProblems(values))

    const openByLabel = values.openByLabel as boolean

    return this.database.forTenant(identity, async (tx) => {
      await changedInEveryArea(tx)

      await tx
        .insert(faultReportSettings)
        .values({ tenantId: identity.tenantId, openByLabel })
        .onConflictDoUpdate({
          target: [faultReportSettings.tenantId],
          set: { openByLabel, updatedAt: new Date() },
        })

      return { openByLabel }
    })
  }
}
