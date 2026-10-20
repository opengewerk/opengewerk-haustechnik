import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  closedLabelSentence,
  fileSizeProblem,
  type OutsideLabelPage,
  type OutsideReportReceipt,
  outsideReportProblems,
  outsideReportRules,
  roomTitle,
  staleFormSentence,
  tooManyReportsSentence,
} from '@opengewerk/haustechnik-domain'
import {
  AcceptsBody,
  type AddressedRequest,
  bodyBytesOf,
  clientAddress,
  Database,
  FILE_STORE,
  type FileStorage,
  fileRowFor,
  fileUploadType,
  isUuid,
  recognisedMediaType,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { inLabelArea, type OpenLabel, openLabel } from '../database/label-area.js'
import {
  assets,
  faultCategories,
  faultReportContacts,
  faultReports,
  labels,
  rooms,
} from '../database/schema/index.js'
import { categoriesOf } from '../faults/reading.js'
import { OUTSIDE_REPORTS, type OutsideReports } from '../faults/outside-gate.js'
import { PublicRoute } from './authorization.js'
import { fieldsOf, refuse } from './places.js'

/** The request a body is read from, as the foundation reads it, with its address. */
type BodyRequest = Parameters<typeof bodyBytesOf>[0] & AddressedRequest

type CategoryId = (typeof faultCategories.$inferSelect)['id']
type ReportId = (typeof faultReports.$inferSelect)['id']
type ReportRow = typeof faultReports.$inferInsert

/** The answer for every code that takes no report, whatever the reason. */
const closed: OutsideLabelPage = { open: false }

function tooMany(): HttpException {
  return new HttpException({ message: tooManyReportsSentence }, HttpStatus.TOO_MANY_REQUESTS)
}

/** Where a report over a label stands: its building always, and its room, or its asset. */
interface LabelPlace {
  readonly propertyId: ReportRow['propertyId']
  readonly areaId: ReportRow['areaId']
  readonly buildingId: ReportRow['buildingId']
  readonly roomId: NonNullable<ReportRow['roomId']> | null
  readonly assetId: NonNullable<ReportRow['assetId']> | null
  /** The room the page names: the room of the label, or the room its asset stands in. */
  readonly roomOnTheLabel: string | null
}

/**
 * Where a label hangs, read in its area: a room, or an asset with the room it
 * stands in. Nothing where the label, its room or its asset is gone; the
 * function that opened the label said it was valid a moment ago, and this is
 * the same question asked again under the policies.
 */
async function placeOfLabel(tx: TenantTransaction, code: string): Promise<LabelPlace | null> {
  const [label] = await tx
    .select({ assetId: labels.assetId, roomId: labels.roomId })
    .from(labels)
    .where(and(eq(labels.code, code), isNull(labels.blockedAt), isNull(labels.deletedAt)))

  if (label === undefined) {
    return null
  }

  if (label.assetId !== null) {
    const [asset] = await tx
      .select({
        propertyId: assets.propertyId,
        areaId: assets.areaId,
        buildingId: assets.buildingId,
        roomId: assets.roomId,
      })
      .from(assets)
      .where(and(eq(assets.id, label.assetId), isNull(assets.deletedAt)))

    if (asset === undefined) {
      return null
    }

    const [room] =
      asset.roomId === null
        ? []
        : await tx
            .select({ number: rooms.number, name: rooms.name })
            .from(rooms)
            .where(and(eq(rooms.id, asset.roomId), isNull(rooms.deletedAt)))

    return {
      propertyId: asset.propertyId,
      areaId: asset.areaId,
      buildingId: asset.buildingId,
      roomId: null,
      assetId: label.assetId,
      roomOnTheLabel: room === undefined ? null : roomTitle(room),
    }
  }

  if (label.roomId !== null) {
    const [room] = await tx
      .select({
        propertyId: rooms.propertyId,
        areaId: rooms.areaId,
        buildingId: rooms.buildingId,
        number: rooms.number,
        name: rooms.name,
      })
      .from(rooms)
      .where(and(eq(rooms.id, label.roomId), isNull(rooms.deletedAt)))

    return room === undefined
      ? null
      : {
          propertyId: room.propertyId,
          areaId: room.areaId,
          buildingId: room.buildingId,
          roomId: label.roomId,
          assetId: null,
          roomOnTheLabel: roomTitle(room),
        }
  }

  return null
}

/**
 * The page of a label for somebody without an account (section 4.7 of the
 * concept, #332). The label at a room or an asset opens it once the Leitung
 * switched it on; it names the room and nothing else, takes a category, a
 * description, a photo and, if somebody wants an answer, an address for mail,
 * and the report lands in the inbox like one with an account, naming nobody.
 *
 * Three routes and no person behind any of them, so each says why it may
 * stand without one (`PublicRoute`). Every code that takes no report gets the
 * same answer, whether it is unknown, blocked, on nothing, or its operator
 * has the page off: nobody outside learns which codes exist. The limits per
 * address and per label, the form with its least time and the field nobody
 * sees are `OutsideReports`; the way into the database is `openLabel` and
 * `inLabelArea`, which see the one area of the label.
 */
@Controller('fault-reports/by-label')
export class OutsideReportsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OUTSIDE_REPORTS) private readonly gate: OutsideReports,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /** The page of a label: closed, or the room on the label, the categories and the form. */
  @Get(':code')
  @PublicRoute()
  async page(@Param('code') code: string, @Req() request: BodyRequest): Promise<OutsideLabelPage> {
    if (!this.gate.openPage(clientAddress(request))) {
      throw tooMany()
    }

    const label = await openLabel(this.database, code)

    if (label === null) {
      return closed
    }

    const open = await inLabelArea(this.database, label, async (tx) => {
      const place = await placeOfLabel(tx, code)

      return place === null
        ? null
        : { room: place.roomOnTheLabel, categories: await categoriesOf(tx) }
    })

    return open === null || open.categories.length === 0
      ? closed
      : { open: true, ...open, form: this.gate.form(code) }
  }

  /**
   * A report over a label. Counted against its address before anything else,
   * and against its code once it has passed its checks and is written
   * (#472); a form sent faster than a person reads the page, and the field
   * nobody sees filled in, are answered as a report is and keep nothing, so
   * that a machine learns nothing from the answer.
   */
  @Post(':code')
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  async report(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() request: BodyRequest,
  ): Promise<OutsideReportReceipt> {
    if (!this.gate.takeReport(clientAddress(request), code)) {
      throw tooMany()
    }

    const values = fieldsOf(
      body,
      ['categoryId', 'description', 'contact', 'photo', 'form', 'website'],
      ['contact', 'photo', 'website'],
    )
    const nothingKept: OutsideReportReceipt = { photo: null }

    if (typeof values['website'] === 'string' && values['website'] !== '') {
      return nothingKept
    }

    const form = this.gate.formState(code, values['form'])

    if (form === 'stale') {
      throw new BadRequestException(staleFormSentence)
    }

    if (form === 'early') {
      return nothingKept
    }

    refuse(outsideReportProblems(values))

    const missingCategory = 'Diese Kategorie gibt es nicht mehr. Laden Sie die Seite neu.'

    if (!isUuid(String(values['categoryId']))) {
      throw new BadRequestException(missingCategory)
    }

    const label = await openLabel(this.database, code)

    if (label === null) {
      throw new NotFoundException(closedLabelSentence)
    }

    const contact = typeof values['contact'] === 'string' ? values['contact'].trim() : ''
    const reportId = await inLabelArea(this.database, label, async (tx) => {
      const place = await placeOfLabel(tx, code)

      if (place === null) {
        throw new NotFoundException(closedLabelSentence)
      }

      const [category] = await tx
        .select({ id: faultCategories.id })
        .from(faultCategories)
        .where(
          and(
            eq(faultCategories.id, String(values['categoryId']) as CategoryId),
            isNull(faultCategories.removedAt),
          ),
        )

      if (category === undefined) {
        throw new BadRequestException(missingCategory)
      }

      // Only now: a request that fails at a check before does not use up the
      // reports a label takes (#472).
      if (!this.gate.takeLabel(code)) {
        throw tooMany()
      }

      const [made] = await tx
        .insert(faultReports)
        .values({
          tenantId: label.tenantId,
          propertyId: place.propertyId,
          areaId: place.areaId,
          buildingId: place.buildingId,
          roomId: place.roomId,
          assetId: place.assetId,
          categoryId: category.id,
          description: String(values['description']).trim(),
          reportedBy: null,
          reportedOutside: true,
        })
        .returning({ id: faultReports.id })

      if (made === undefined) {
        throw new Error('The fault report was not written')
      }

      if (contact !== '') {
        await tx.insert(faultReportContacts).values({
          tenantId: label.tenantId,
          faultReportId: made.id,
          propertyId: place.propertyId,
          areaId: place.areaId,
          address: contact,
        })
      }

      return made.id
    })

    return {
      photo:
        values['photo'] === true
          ? this.gate.promisePhoto({ ...labelOf(label), reportId, code })
          : null,
    }
  }

  /**
   * The photo of a report just sent, once, with the slip its answer carried.
   * Only a picture whose first bytes say so is taken.
   */
  @Put(':code/photo/:slip')
  @PublicRoute()
  @HttpCode(HttpStatus.NO_CONTENT)
  @AcceptsBody([fileUploadType], 'Ein Foto wird als application/octet-stream geschickt.')
  async photo(
    @Param('code') code: string,
    @Param('slip') token: string,
    @Req() request: BodyRequest,
  ): Promise<void> {
    const slip = this.gate.photoFor(token)

    if (slip === null || slip.code !== code) {
      throw new NotFoundException(
        'Das Foto passt zu keiner Meldung mehr. Die Meldung selbst ist angekommen.',
      )
    }

    const body = await bodyBytesOf(request, outsideReportRules.photoBytes)

    if (body === null) {
      throw new PayloadTooLargeException(
        fileSizeProblem(outsideReportRules.photoBytes + 1) ?? undefined,
      )
    }

    const empty = fileSizeProblem(body.byteLength)

    if (empty) {
      throw new BadRequestException(empty)
    }

    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    const mediaType = recognisedMediaType(bytes)

    // From outside, a declared type counts for nothing (section 4.10 of the
    // concept): the first bytes say what a picture is.
    if (
      mediaType === null ||
      !(outsideReportRules.photoTypes as readonly string[]).includes(mediaType)
    ) {
      throw new UnprocessableEntityException(
        'Ein Foto ist ein Bild als JPEG, PNG oder WebP. Die Meldung selbst ist angekommen.',
      )
    }

    const blob = await this.store.put(bytes)

    await inLabelArea(this.database, slip, async (tx) => {
      await fileRowFor(tx, slip.tenantId, blob, mediaType)
      await tx
        .update(faultReports)
        .set({ photoSha256: blob.sha256, updatedAt: new Date() })
        .where(
          and(
            eq(faultReports.id, slip.reportId as ReportId),
            eq(faultReports.reportedOutside, true),
            isNull(faultReports.photoSha256),
          ),
        )
    })
  }
}

/** The operator and the area a slip for a photo carries, from the label of the report. */
function labelOf(label: OpenLabel): Pick<OpenLabel, 'tenantId' | 'areaId'> {
  return { tenantId: label.tenantId, areaId: label.areaId }
}
