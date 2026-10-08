import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common'
import {
  type Asset,
  type AssetEvidenceEntry,
  type Catalogue,
  correctionProblems,
  type DutyEvidenceEntry,
  type DutyId,
  type EvidenceId,
  evidenceLimits,
  type EvidenceLink,
  type EvidencePage,
  type EvidenceResult,
  evidenceStandingOf,
  type IsoDate,
  readEvidenceState,
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
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { files } from '@opengewerk/platform-server/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { dutyTitle } from '../database/duty-standing.js'
import { assets, duties, evidence, evidenceVoidings, rooms } from '../database/schema/index.js'
import { voidEvidence } from '../evidence/voiding.js'
import { EvidenceRefusal, writeEvidence } from '../evidence/write.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

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
      replacesEvidenceId: evidence.replacesEvidenceId,
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
    const { replacesEvidenceId: _, ...shown } = row

    return { ...shown, standing: standing(row) }
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
  async page(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<EvidencePage> {
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
        ofTheDuty,
        voiding: voiding ?? null,
        replacedBy: (
          await tx
            .select({ id: evidence.id, number: evidence.number })
            .from(evidence)
            .where(eq(evidence.replacesEvidenceId, row.id))
        )[0],
      }
    })
    const { row, voiding } = read
    // Accounts are read on the instance and never inside a tenant.
    const accounts = await accountsOf(
      this.database,
      voiding === null ? [] : [voiding.voidedBy],
      identity.userId,
    )
    const replaced = read.ofTheDuty.find((entry) => entry.id === row.replacesEvidenceId)

    return {
      id: row.id,
      number: row.number,
      dutyId: row.dutyId,
      place: read.place,
      state: readEvidenceState(row.state),
      fingerprint: row.fingerprint,
      standing: read.ofTheDuty.find((entry) => entry.id === row.id)?.standing ?? 'counts',
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
    }
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
      const row = await evidenceOf(tx, id)
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
    const known = await this.database.forTenant(identity, (tx) => evidenceOf(tx, id))

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
            // set right or given another day since.
            defects: state.defects,
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
      const known = await evidenceOf(tx, id)

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
}
