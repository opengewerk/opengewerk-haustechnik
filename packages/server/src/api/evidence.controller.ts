import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type Asset,
  assetBookWords,
  type AssetEvidenceEntry,
  type Catalogue,
  correctionProblems,
  type DutyEvidenceEntry,
  type DutyId,
  type EvidenceId,
  evidenceLimits,
  type EvidenceLink,
  type EvidenceReading,
  type EvidenceResult,
  evidenceStandingOf,
  isAllowed,
  type IsoDate,
  missingRight,
  readEvidenceState,
  retentionInWords,
  retentionSentences,
  type SignedPrint,
  signedPrintWords,
  type StatedRetention,
  statedReasonProblem,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  dispositionFor,
  FILE_STORE,
  type FileStorage,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { files } from '@opengewerk/platform-server/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { dutyTitle } from '../database/duty-standing.js'
import {
  assets,
  duties,
  evidence,
  evidenceEmptyings,
  evidenceSignedPrints,
  evidenceVoidings,
  prints,
  rooms,
} from '../database/schema/index.js'
import { checkSignedPdf, SignedPdfRefusal } from '../evidence/signed-pdf.js'
import { assetBookPrintJob, type BookPages } from '../prints/asset-book-page.js'
import {
  carriedWith,
  type EvidenceAttachment,
  withEvidenceBehind,
} from '../prints/evidence-bundle.js'
import { voidEvidence } from '../evidence/voiding.js'
import { EvidenceRefusal, writeEvidence } from '../evidence/write.js'
import { dayInGermany } from '../today.js'
import { assetBookOf, assetBookTable } from './asset-book.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'
import { pdf, Printer } from './prints.controller.js'

const missing = 'Diesen Nachweis gibt es nicht.'
const missingFile = 'Diese Datei gibt es an diesem Nachweis nicht.'
const missingAsset = 'Diese Anlage gibt es nicht oder nicht mehr.'

/** What stands for a person whose account is not there any more. */
const unknownAccount = 'Unbekanntes Konto'

/**
 * An evidence the person asking sees, in one of their areas, which the policy
 * decides. One elsewhere and an id that is no id get the same answer. An
 * evidence is never marked deleted, so there is nothing else to leave out.
 */
async function evidenceOf(tx: TenantTransaction, id: string) {
  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  const [row] = await tx
    .select()
    .from(evidence)
    .where(eq(evidence.id, id as EvidenceId))

  if (row === undefined) {
    throw new NotFoundException(missing)
  }

  return row
}

/**
 * An evidence that is more than its empty shell, for what hands out its
 * content or builds on it: its files, a correction and a declaration of
 * invalidity (#340). The shell holds nothing to hand out or to correct.
 */
async function writtenEvidenceOf(tx: TenantTransaction, id: string) {
  const row = await evidenceOf(tx, id)

  if (row.emptiedAt !== null) {
    throw new ConflictException(retentionSentences.emptied)
  }

  return row
}

/**
 * The evidence of these duties, the newest first, each with what it means for
 * the appointment of its duty (ADR 0004, points 14 and 15). A correction is of
 * the duty of the evidence it replaces, so the duties may be read together.
 */
export async function listedEvidence(
  tx: TenantTransaction,
  dutyIds: readonly DutyId[],
): Promise<(DutyEvidenceEntry & { readonly dutyId: DutyId })[]> {
  if (dutyIds.length === 0) {
    return []
  }

  const written = await tx
    .select({
      id: evidence.id,
      dutyId: evidence.dutyId,
      number: evidence.number,
      performedOn: evidence.performedOn,
      result: evidence.result,
      origin: evidence.origin,
      nextDueOn: evidence.nextDueOn,
      replacesEvidenceId: evidence.replacesEvidenceId,
      emptiedAt: evidence.emptiedAt,
    })
    .from(evidence)
    .where(inArray(evidence.dutyId, [...dutyIds]))
    .orderBy(desc(evidence.performedOn), desc(evidence.writtenAt))
  const voided =
    written.length === 0
      ? []
      : await tx
          .select({ evidenceId: evidenceVoidings.evidenceId })
          .from(evidenceVoidings)
          .where(
            inArray(
              evidenceVoidings.evidenceId,
              written.map((row) => row.id),
            ),
          )
  const standing = evidenceStandingOf(
    written,
    new Set(voided.map((row) => row.evidenceId as string)),
  )

  return written.map((row) => {
    const { replacesEvidenceId: _, nextDueOn, emptiedAt, ...shown } = row

    // The due day of a list only where an evidence was taken over with one (#130),
    // and the mark of the shell only on one (#340).
    return {
      ...shown,
      standing: standing(row),
      ...(nextDueOn === null ? {} : { nextDueOn }),
      ...(emptiedAt === null ? {} : { emptied: true as const }),
    }
  })
}

/**
 * The page of an evidence and the two things that may become of it (2.6 of
 * the concept, ADR 0004, points 14 to 16): a correction, which is a new
 * evidence of the same duty that names the old one, and a declaration of
 * invalidity, which is a row of its own. Neither changes the evidence, and
 * nothing here sets an answer, a signature or an evidence back.
 *
 * Reading is the right of the evidence, and so is correcting and declaring
 * invalid; the database holds the area of each.
 */
@Controller('evidence')
export class EvidenceController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /**
   * An evidence whole: its frozen state, which names who did, signed and
   * wrote it down, the fingerprint over it, what it means for its duty, the
   * evidence it replaces or that replaced it, and a declaration of
   * invalidity with the person and the reason.
   */
  @Get(':id')
  @RequiresPermission('evidence.read')
  async page(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<EvidenceReading> {
    const read = await this.database.forTenant(identity, async (tx) => {
      const row = await evidenceOf(tx, id)
      // The duty as it is today, also when it was ended or entered by
      // mistake: its evidence stays readable.
      const [duty] = await tx.select().from(duties).where(eq(duties.id, row.dutyId))
      const assetId = duty?.assetId ?? null
      const [asset] =
        assetId === null
          ? []
          : await tx
              .select({ buildingId: assets.buildingId, roomId: assets.roomId })
              .from(assets)
              .where(eq(assets.id, assetId))
      const roomId = asset?.roomId ?? duty?.roomId ?? null
      const [room] =
        roomId === null
          ? []
          : await tx
              .select({ buildingId: rooms.buildingId })
              .from(rooms)
              .where(eq(rooms.id, roomId))
      const ofTheDuty = await listedEvidence(tx, [row.dutyId])
      const [voiding] = await tx
        .select()
        .from(evidenceVoidings)
        .where(eq(evidenceVoidings.evidenceId, row.id))

      return {
        row,
        place: {
          propertyId: row.propertyId,
          buildingId: asset?.buildingId ?? room?.buildingId ?? duty?.buildingId ?? null,
          roomId,
          assetId,
        },
        duty,
        ofTheDuty,
        voiding: voiding ?? null,
        // The PDFs with a higher signature, signed outside (#341).
        signed: await tx
          .select()
          .from(evidenceSignedPrints)
          .where(eq(evidenceSignedPrints.evidenceId, row.id))
          .orderBy(desc(evidenceSignedPrints.filedAt)),
        // What the confirmation found, for the shell after the end of the retention (#340).
        emptying:
          row.emptiedAt === null
            ? null
            : ((
                await tx
                  .select()
                  .from(evidenceEmptyings)
                  .where(eq(evidenceEmptyings.evidenceId, row.id))
              )[0] ?? null),
        replacedBy: (
          await tx
            .select({ id: evidence.id, number: evidence.number })
            .from(evidence)
            .where(eq(evidence.replacesEvidenceId, row.id))
        )[0],
      }
    })
    const { row, voiding, emptying } = read
    // Accounts are read on the instance and never inside a tenant.
    const accounts = await accountsOf(
      this.database,
      [
        ...(voiding === null ? [] : [voiding.voidedBy]),
        ...(emptying === null ? [] : [emptying.confirmedBy]),
        ...read.signed.map((each) => each.filedBy),
      ],
      identity.userId,
    )
    const standing = read.ofTheDuty.find((entry) => entry.id === row.id)?.standing ?? 'counts'

    if (row.emptiedAt !== null) {
      return {
        id: row.id,
        number: row.number,
        dutyId: row.dutyId,
        dutyTitle: read.duty === undefined ? row.number : dutyTitle(read.duty, this.catalogue),
        place: read.place,
        performedOn: row.performedOn,
        result: row.result,
        standing,
        emptied: {
          at: (emptying?.confirmedAt ?? row.emptiedAt).toISOString(),
          confirmedBy:
            emptying === null
              ? unknownAccount
              : (accounts.get(emptying.confirmedBy)?.name ?? unknownAccount),
          retention: retentionInWords(
            (emptying?.retention ?? null) as StatedRetention | null,
            emptying?.minimumYears ?? null,
          ),
          endedOn: (emptying?.endedOn ?? row.performedOn) as IsoDate,
        },
        voided:
          voiding === null
            ? null
            : {
                voidedBy: accounts.get(voiding.voidedBy)?.name ?? unknownAccount,
                voidedAt: voiding.voidedAt.toISOString(),
              },
      }
    }
    const replaced = read.ofTheDuty.find((entry) => entry.id === row.replacesEvidenceId)

    return {
      id: row.id,
      number: row.number,
      dutyId: row.dutyId,
      place: read.place,
      state: readEvidenceState(row.state),
      fingerprint: row.fingerprint,
      standing,
      replaces: replaced === undefined ? null : { id: replaced.id, number: replaced.number },
      replacedBy: read.replacedBy ?? null,
      voiding:
        voiding === null
          ? null
          : {
              reason: voiding.reason,
              voidedBy: accounts.get(voiding.voidedBy)?.name ?? unknownAccount,
              voidedAt: voiding.voidedAt.toISOString(),
            },
      signedPrints: read.signed.map((each): SignedPrint => ({
        id: each.id,
        signer: each.signer,
        issuer: each.issuer,
        signedAt: each.signedAt?.toISOString() ?? null,
        validFrom: each.validFrom.toISOString(),
        validTo: each.validTo.toISOString(),
        filedBy: accounts.get(each.filedBy)?.name ?? unknownAccount,
        filedAt: each.filedAt.toISOString(),
      })),
    }
  }

  /**
   * The PDF of this evidence with a higher signature, signed outside, filed at
   * it (#341; decided on 15.10.2026: only taken). The file went up ahead,
   * under the right to file a document; here it is named by its hash and
   * checked (`evidence/signed-pdf.ts`): it is one of the prints of this
   * evidence with a signature appended that covers the whole file and fits its
   * certificate. The evidence does not change. Filing is entering evidence.
   */
  @Post(':id/signed-prints')
  @RequiresPermission('evidence.write')
  async fileSigned(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SignedPrint> {
    const { sha256 } = fieldsOf(body, ['sha256'], [])

    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new BadRequestException(signedPrintWords.missingFile)
    }

    const known = await this.database.forTenant(identity, async (tx) => {
      const row = await writtenEvidenceOf(tx, id)
      const [stored] = await tx
        .select({ sha256: files.sha256 })
        .from(files)
        .where(and(eq(files.tenantId, identity.tenantId), eq(files.sha256, sha256)))
      const printed = await tx
        .select({ sha256: prints.sha256 })
        .from(prints)
        .where(eq(prints.evidenceId, row.id))

      return { row, stored, printed }
    })

    if (known.stored === undefined) {
      throw new BadRequestException(signedPrintWords.missingFile)
    }

    if (known.printed.length === 0) {
      throw new ConflictException(signedPrintWords.noPrint)
    }

    const file = await this.store.get(sha256)
    const printBytes = await Promise.all(known.printed.map((each) => this.store.get(each.sha256)))
    let facts: ReturnType<typeof checkSignedPdf>

    try {
      facts = checkSignedPdf(file, printBytes)
    } catch (error) {
      throw error instanceof SignedPdfRefusal
        ? new UnprocessableEntityException(error.message)
        : error
    }

    const accounts = await accountsOf(this.database, [identity.userId], identity.userId)
    const [written] = await this.database.forTenant(identity, (tx) =>
      tx
        .insert(evidenceSignedPrints)
        .values({
          tenantId: identity.tenantId,
          propertyId: known.row.propertyId,
          areaId: known.row.areaId,
          evidenceId: known.row.id,
          sha256,
          signer: facts.signer.slice(0, 500),
          issuer: facts.issuer.slice(0, 500),
          signedAt: facts.signedAt,
          validFrom: facts.validFrom,
          validTo: facts.validTo,
          filedBy: identity.userId,
        })
        .onConflictDoNothing()
        .returning(),
    )

    if (written === undefined) {
      throw new ConflictException(signedPrintWords.twice)
    }

    return {
      id: written.id,
      signer: written.signer,
      issuer: written.issuer,
      signedAt: written.signedAt?.toISOString() ?? null,
      validFrom: written.validFrom.toISOString(),
      validTo: written.validTo.toISOString(),
      filedBy: accounts.get(identity.userId)?.name ?? unknownAccount,
      filedAt: written.filedAt.toISOString(),
    }
  }

  /** A PDF with a higher signature filed at this evidence, as it was filed (#341). */
  @Get(':id/signed-prints/:printId')
  @RequiresPermission('evidence.read')
  @Header('Cache-Control', 'no-store')
  async signedPrint(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('printId') printId: string,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const row = await evidenceOf(tx, id)

      if (!isUuid(printId)) {
        return null
      }

      const [held] = await tx
        .select({ sha256: evidenceSignedPrints.sha256 })
        .from(evidenceSignedPrints)
        .where(
          and(
            eq(evidenceSignedPrints.id, printId as typeof evidenceSignedPrints.$inferSelect.id),
            eq(evidenceSignedPrints.evidenceId, row.id),
          ),
        )

      return held === undefined ? null : { number: row.number, sha256: held.sha256 }
    })

    if (found === null) {
      throw new NotFoundException(signedPrintWords.missing)
    }

    const bytes = await this.store.get(found.sha256)

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: dispositionFor('application/pdf', `Nachweis ${found.number} signiert.pdf`),
    })
  }

  /**
   * A file the evidence rests on, by its place among the files of its frozen
   * state, as it arrived: the report of a contractor, for one. The evidence
   * hands it out itself, to whoever sees the evidence, so that it keeps its
   * file whatever becomes of the document the file was filed as; a document
   * taken out of the filing is handed out to nobody any more (ADR 0004,
   * addendum of #110). Never by the hash of the file, which names no record.
   *
   * The type is the one the server read off the first bytes when the file was
   * stored, and anything that is neither a picture nor a PDF is handed out to
   * be saved, as the foundation does for a document.
   */
  @Get(':id/files/:position')
  @RequiresPermission('evidence.read')
  @Header('Cache-Control', 'no-store')
  async file(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('position') position: string,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const row = await writtenEvidenceOf(tx, id)
      const named = /^\d{1,3}$/.test(position)
        ? readEvidenceState(row.state).files[Number(position)]
        : undefined

      if (named === undefined) {
        return null
      }

      const [stored] = await tx
        .select({ sha256: files.sha256, mediaType: files.mediaType })
        .from(files)
        .where(and(eq(files.tenantId, identity.tenantId), eq(files.sha256, named.sha256)))

      return stored === undefined ? null : { ...stored, name: named.name }
    })

    if (found === null) {
      throw new NotFoundException(missingFile)
    }

    const bytes = await this.store.get(found.sha256)

    return new StreamableFile(Buffer.from(bytes), {
      type: found.mediaType,
      disposition: dispositionFor(found.mediaType, found.name),
    })
  }

  /**
   * A correction (ADR 0004, point 14): a new evidence of the same duty with
   * the corrected day and result, and for a report the examiner, which names
   * the one it replaces and why. Everything else it takes from that one: the
   * activity, who performed it, the files and the defects as it states them.
   * Not the signatures: each was given to the page that was shown then, and
   * stays on the evidence it signed. The new evidence names who wrote it down, and that is the person
   * correcting.
   */
  @Post(':id/correction')
  @RequiresPermission('evidence.write')
  async correct(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<EvidenceLink> {
    const values = fieldsOf(
      body,
      ['reason', 'performedOn', 'result', 'resultReason', 'examiner', 'examinerOrganisation'],
      ['resultReason', 'examiner', 'examinerOrganisation'],
    )
    // An evidence never changes, so what it is may be read before the
    // transaction that corrects it: the names it needs are asked of the
    // instance, which happens outside a tenant.
    const known = await this.database.forTenant(identity, (tx) => writtenEvidenceOf(tx, id))

    refuse(correctionProblems(values, known.origin, dayInGermany()))

    const accounts = await accountsOf(
      this.database,
      [identity.userId, ...(known.performedBy === null ? [] : [known.performedBy])],
      identity.userId,
    )
    const state = readEvidenceState(known.state)

    return this.database.forTenant(identity, async (tx) => {
      try {
        const written = await writeEvidence(
          tx,
          {
            tenantId: identity.tenantId,
            writtenBy: identity.userId,
            at: new Date(),
            catalogue: this.catalogue,
            nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
          },
          {
            dutyId: known.dutyId,
            activityId: known.activityId,
            origin: known.origin,
            performedOn: values.performedOn as IsoDate,
            result: values.result as EvidenceResult,
            resultReason: (values.resultReason ?? null) as string | null,
            performedBy: known.performedBy,
            examiner:
              known.origin === 'report'
                ? {
                    name: values.examiner as string,
                    organisation: values.examinerOrganisation as string,
                  }
                : known.examiner === null || known.examinerOrganisation === null
                  ? null
                  : { name: known.examiner, organisation: known.examinerOrganisation },
            signatures: [],
            files: state.files,
            // As the work named them then: a report without an activity has
            // them nowhere else, and a defect of an activity may have been
            // set right or given another day since. What was said with the
            // result was said on site, and a correction does not say it again.
            defects: state.defects,
            remark: state.remark,
            // What a list named for the holdings of a predecessor stays with
            // them (#130), as long as it still lies after their day.
            nextDueOn:
              state.nextDueOn !== null && state.nextDueOn > (values.performedOn as IsoDate)
                ? state.nextDueOn
                : null,
            replaces: { evidenceId: known.id, reason: values.reason as string },
          },
        )

        return { id: written.id, number: written.number }
      } catch (error) {
        throw error instanceof EvidenceRefusal ? new ConflictException(error.message) : error
      }
    })
  }

  /**
   * A declaration of invalidity (ADR 0004, point 15), with the reason; the
   * person and the moment come from the request. The evidence stays as it
   * is and counts no more for its duty. It is not taken back.
   */
  @Post(':id/voiding')
  @RequiresPermission('evidence.write')
  voiding(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<EvidenceLink> {
    const { reason } = fieldsOf(body, ['reason'])
    const problem = statedReasonProblem(
      reason,
      evidenceLimits.voidingReason,
      'Eine Ungültigerklärung nennt ihren Grund.',
    )

    refuse(problem === undefined ? {} : { reason: problem })

    return this.database.forTenant(identity, async (tx) => {
      const known = await writtenEvidenceOf(tx, id)

      try {
        const taken = await voidEvidence(
          tx,
          { tenantId: identity.tenantId, writtenBy: identity.userId, at: new Date() },
          { evidenceId: known.id, reason: reason as string },
        )

        return { id: known.id, number: taken.number }
      } catch (error) {
        throw error instanceof EvidenceRefusal ? new ConflictException(error.message) : error
      }
    })
  }
}

/**
 * The evidence of an asset, for its file and its page on site: of every duty
 * that hangs on it, also of one that ended or was entered by mistake, the
 * newest first, each with its duty. Reading it is reading evidence. The
 * evidence of its components stands in their files.
 */
@Controller('assets')
export class AssetEvidenceController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
    private readonly printer: Printer,
  ) {}

  @Get(':id/evidence')
  @RequiresPermission('evidence.read')
  ofAsset(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<AssetEvidenceEntry[]> {
    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missingAsset)
      const its = await tx
        .select({
          id: duties.id,
          kind: duties.kind,
          kindVersion: duties.kindVersion,
          label: duties.label,
        })
        .from(duties)
        .where(eq(duties.assetId, asset.id))
      const titles = new Map(its.map((duty) => [duty.id, dutyTitle(duty, this.catalogue)]))

      return (
        await listedEvidence(
          tx,
          its.map((duty) => duty.id),
        )
      ).map((entry) => ({ ...entry, dutyTitle: titles.get(entry.dutyId) ?? 'Pflicht' }))
    })
  }

  /**
   * The book of the asset as a PDF (#437, section 8 of the concept): all its
   * evidence in the order of time with its life cycle, under the name its
   * kind gives it, for the day it is asked for and never kept. With
   * `attach=1` every evidence follows it once, as the print it keeps and the
   * files it rests on, read as the person, and every line names the page its
   * evidence begins on. Whoever reads the asset and its evidence makes it; no
   * right of its own.
   */
  @Get(':id/book/pdf')
  @RequiresPermission('evidence.read')
  async bookPdf(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    readsAssets(identity)

    const today = dayInGermany()
    const book = await this.database.forTenant(identity, async (tx) =>
      assetBookOf(
        tx,
        identity,
        this.catalogue,
        await placeOf<Asset>(tx, assets, id, missingAsset),
        today,
      ),
    )
    const listed = (attached: BookPages | null) =>
      this.printer.fresh(assetBookPrintJob(book.head, book.lines, attached))
    const name = `${book.head.title} ${book.head.asset} ${today}`

    if (query['attach'] !== '1') {
      return pdf(response, await listed(null), name)
    }

    const attachments: EvidenceAttachment<EvidenceId>[] = []
    let carried = 0

    for (const line of book.lines) {
      const printed =
        line.evidenceId === null
          ? null
          : await this.printer.evidencePrint(identity, line.evidenceId)

      if (line.evidenceId !== null && printed !== null) {
        const attachment = {
          key: line.evidenceId,
          print: printed.bytes,
          files: await this.printer.evidenceFiles(identity, line.evidenceId),
        }
        const next = carriedWith(carried, attachment)

        // A book past the limit is refused rather than read whole into memory.
        if (next === null) {
          throw new UnprocessableEntityException(assetBookWords.tooLarge)
        }

        carried = next
        attachments.push(attachment)
      }
    }

    return pdf(
      response,
      await this.printer.sign(await withEvidenceBehind(attachments, listed)),
      `${name} mit Nachweisen`,
    )
  }

  /**
   * The book of the asset as a table (#437), a row per entry, as a workbook
   * or as text (`?format=xlsx` or `csv`). Like the PDF it names no person of
   * the operator.
   */
  @Get(':id/book/table')
  @RequiresPermission('evidence.read')
  @Header('Cache-Control', 'no-store')
  async bookTable(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    readsAssets(identity)

    const format = tableFormatOf(query)
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        assetBookTable(
          await assetBookOf(
            tx,
            identity,
            this.catalogue,
            await placeOf<Asset>(tx, assets, id, missingAsset),
            today,
          ),
        ),
        format,
        today,
      ),
    )
  }
}

/** The book is of an asset: whoever makes it reads the asset as well as its evidence. */
function readsAssets(identity: Asking): void {
  if (!isAllowed(identity, 'asset.read')) {
    throw new ForbiddenException(missingRight('asset.read'))
  }
}
