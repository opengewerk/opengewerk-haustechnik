import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import {
  type ActivityId,
  type EvidenceId,
  type IsoDate,
  readEvidenceState,
  type StatedAnswer,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  FILE_STORE,
  type FileStorage,
  fileRowFor,
  isUuid,
  type PrintJob,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  activities,
  evidence,
  evidenceVoidings,
  prints,
  roundRecords,
} from '../database/schema/index.js'
import { evidencePrintJob, type PrintedPhoto, roundPrintJob } from '../prints/record-page.js'
import { inSight } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/** What a route needs of the answer: one header. */
interface Response {
  setHeader(name: string, value: string): void
}

/** What a print is of: an evidence, as it is or declared invalid, or a round. */
type PrintOf =
  | { readonly evidenceId: EvidenceId; readonly voided: boolean }
  | { readonly activityId: ActivityId }

/** The sentence when the instance has no renderer: the page says so instead of failing. */
export const noRenderer =
  'Auf dieser Instanz ist kein Dienst eingerichtet, der PDFs erzeugt. Der eingefrorene Stand bleibt unverändert; das PDF entsteht, sobald der Dienst läuft.'

/**
 * The PDF of an evidence and of a round (section 2.6 of the concept, #111):
 * "das PDF entsteht beim ersten Abruf und liegt danach im inhaltsadressierten
 * Speicher. Ein späterer Export liest den eingefrorenen Stand und nie die
 * laufenden Daten." Made from the frozen state the first time it is asked
 * for, kept in the store under its hash with a row that says what it is of,
 * and handed out from there every time after: the same file byte for byte,
 * whatever changed in the records, the template or the account since. An
 * evidence declared invalid is printed once more, with the declaration.
 *
 * Reading is the right of the evidence and of the activities, in the areas of
 * the person asking.
 */
@Injectable()
export class Printer {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  /**
   * The bytes of a print: the stored file once there is one, else made now,
   * stored, and noted. Two who ask at the same moment both render; the
   * unique index keeps the first, and the second hands out the file it kept.
   */
  async printed(
    identity: Asking,
    of: PrintOf,
    place: { readonly propertyId: string; readonly areaId: string },
    job: () => Promise<PrintJob>,
  ): Promise<Uint8Array> {
    const kept = await this.database.forTenant(identity, (tx) => keptPrint(tx, of))

    if (kept !== null) {
      return this.store.get(kept)
    }

    let made: Uint8Array

    try {
      made = await this.render(await job())
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(noRenderer)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }

    const blob = await this.store.put(made)
    const sha256 = await this.database.forTenant(identity, async (tx) => {
      await fileRowFor(tx, identity.tenantId, blob, 'application/pdf')
      await tx
        .insert(prints)
        .values({
          tenantId: identity.tenantId,
          propertyId: place.propertyId as never,
          areaId: place.areaId as never,
          ...('evidenceId' in of
            ? { evidenceId: of.evidenceId, voided: of.voided }
            : { activityId: of.activityId }),
          sha256: blob.sha256,
        })
        .onConflictDoNothing()

      return (await keptPrint(tx, of)) ?? blob.sha256
    })

    return sha256 === blob.sha256 ? made : this.store.get(sha256)
  }

  /** The photos of the answers, read from the store by the hash the frozen state names. */
  async photosOf(answers: readonly StatedAnswer[]): Promise<PrintedPhoto[]> {
    const photos: PrintedPhoto[] = []

    for (const answer of answers) {
      if (answer.photo === null || !answer.photo.mediaType.startsWith('image/')) {
        continue
      }

      photos.push({
        caption: answer.remark === null ? answer.label : `${answer.label}: ${answer.remark}`,
        mediaType: answer.photo.mediaType,
        bytes: await this.store.get(answer.photo.sha256),
      })
    }

    return photos
  }
}

/** The PDF of an evidence, as it is or declared invalid. */
@Controller('evidence')
export class EvidencePrintController {
  constructor(
    private readonly database: Database,
    private readonly printer: Printer,
  ) {}

  @Get(':id/pdf')
  @RequiresPermission('evidence.read')
  async evidencePdf(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(id)) {
      throw new NotFoundException(missingEvidence)
    }

    const held = await this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .select()
        .from(evidence)
        .where(eq(evidence.id, id as EvidenceId))

      if (row === undefined) {
        return null
      }

      const [voiding] = await tx
        .select({ reason: evidenceVoidings.reason, voidedAt: evidenceVoidings.voidedAt })
        .from(evidenceVoidings)
        .where(eq(evidenceVoidings.evidenceId, row.id))

      return { row, voiding: voiding ?? null }
    })

    if (held === null) {
      throw new NotFoundException(missingEvidence)
    }

    const { row, voiding } = held
    const state = readEvidenceState(row.state)
    const bytes = await this.printer.printed(
      identity,
      { evidenceId: row.id, voided: voiding !== null },
      { propertyId: row.propertyId, areaId: row.areaId },
      async () =>
        evidencePrintJob(
          state,
          row.fingerprint,
          await this.printer.photosOf(state.answers),
          voiding === null
            ? null
            : {
                on: voiding.voidedAt.toISOString().slice(0, 10) as IsoDate,
                reason: voiding.reason,
              },
        ),
    )

    return pdf(response, bytes, `Nachweis ${state.number}`)
  }
}

/** The PDF of a round written down, of its frozen state as a whole. */
@Controller('rounds')
export class RoundPrintController {
  constructor(
    private readonly database: Database,
    private readonly printer: Printer,
  ) {}

  @Get(':id/pdf')
  @RequiresPermission('activity.read')
  async roundPdf(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isUuid(id)) {
      throw new NotFoundException(missingRound)
    }

    const record = await this.database.forTenant(identity, async (tx) => {
      // A round the person sees: for the house technicians one given to them
      // or to nobody, as on its page.
      const [round] = await tx
        .select({ id: activities.id })
        .from(activities)
        .where(
          and(
            eq(activities.id, id as ActivityId),
            eq(activities.kind, 'round'),
            isNull(activities.deletedAt),
            inSight(identity),
          ),
        )

      if (round === undefined) {
        throw new NotFoundException(missingRound)
      }

      const [found] = await tx
        .select()
        .from(roundRecords)
        .where(eq(roundRecords.activityId, round.id))

      return found ?? null
    })

    if (record === null) {
      throw new NotFoundException(
        'Ein PDF gibt es, sobald der Rundgang abgeschlossen ist: aus dem Stand, der mit der Unterschrift eingefroren wurde.',
      )
    }

    const bytes = await this.printer.printed(
      identity,
      { activityId: record.activityId },
      { propertyId: record.propertyId, areaId: record.areaId },
      async () =>
        roundPrintJob(
          record.state,
          record.fingerprint,
          await this.printer.photosOf(record.state.answers),
        ),
    )

    return pdf(response, bytes, `Rundgang ${record.state.title}`)
  }
}

const missingEvidence = 'Diesen Nachweis gibt es nicht oder nicht in Ihren Bereichen.'
const missingRound = 'Diesen Rundgang gibt es nicht oder nicht in Ihren Bereichen.'

/** The hash of the print of a record, where one was made. */
async function keptPrint(tx: TenantTransaction, of: PrintOf): Promise<string | null> {
  const [row] = await tx
    .select({ sha256: prints.sha256 })
    .from(prints)
    .where(
      'evidenceId' in of
        ? and(eq(prints.evidenceId, of.evidenceId), eq(prints.voided, of.voided))
        : eq(prints.activityId, of.activityId),
    )

  return row?.sha256 ?? null
}

function pdf(response: Response, bytes: Uint8Array, title: string): StreamableFile {
  response.setHeader('Cache-Control', 'no-store')

  return new StreamableFile(Buffer.from(bytes), {
    type: 'application/pdf',
    disposition: `inline; filename="${encodeURIComponent(title)}.pdf"`,
    length: bytes.byteLength,
  })
}
