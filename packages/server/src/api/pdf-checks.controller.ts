import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common'
import {
  largestFileBytes,
  type PdfCheck,
  pdfCheckType,
  pdfCheckWords,
  type PdfKept,
} from '@opengewerk/haustechnik-domain'
import {
  AcceptsBody,
  bodyBytesOf,
  CurrentIdentity,
  Database,
  instanceCertificates,
} from '@opengewerk/platform-server'
import { desc, eq, sql } from 'drizzle-orm'

import {
  activities,
  evidence,
  evidenceSignedPrints,
  prints,
  serviceReports,
} from '../database/schema/index.js'
import { instanceSignatureOf } from '../prints/check.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

type BodyRequest = Parameters<typeof bodyBytesOf>[0]

/**
 * "PDF prüfen" (#457, section 2.6 of the concept): a PDF somebody lays before
 * the office, checked twice. Is it byte for byte a print kept here, the PDF
 * of an evidence, a round or a service report, or a PDF with a higher
 * signature filed at an evidence (#341)? Found by its SHA-256 among what the
 * person sees in their areas, and named only under the right that reads it.
 * And does it carry the signature of this instance, unchanged since?
 *
 * Checking is the right to see the evidence. The file is read and never kept:
 * nothing of it is written anywhere, and the answer names nothing the
 * person could not open themselves.
 */
@Controller('pdf-checks')
export class PdfChecksController {
  constructor(private readonly database: Database) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('evidence.read')
  @AcceptsBody([pdfCheckType], pdfCheckWords.wrongType)
  async check(@CurrentIdentity() identity: Asking, @Req() request: BodyRequest): Promise<PdfCheck> {
    const body = await bodyBytesOf(request, largestFileBytes)

    if (body === null) {
      throw new PayloadTooLargeException(pdfCheckWords.tooLarge)
    }

    if (body.byteLength === 0) {
      throw new BadRequestException(pdfCheckWords.empty)
    }

    const file = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

    if (Buffer.from(file.subarray(0, 5)).toString('latin1') !== '%PDF-') {
      return { pdf: false, kept: null, instance: { state: 'none' } }
    }

    return {
      pdf: true,
      kept: await this.keptAs(identity, createHash('sha256').update(file).digest('hex')),
      instance: instanceSignatureOf(file, await instanceCertificates(this.database)),
    }
  }

  /** The print these bytes are, among what the person sees; the first kept where there are several. */
  private keptAs(identity: Asking, sha256: string): Promise<PdfKept | null> {
    const readsActivities = identity.rights.includes('activity.read')

    return this.database.forTenant(identity, async (tx) => {
      // A round is printed by its activity, a service report by its own row and its order.
      const activityId = sql<
        string | null
      >`coalesce(${prints.activityId}, ${serviceReports.activityId})`
      const [print] = await tx
        .select({
          evidenceId: prints.evidenceId,
          activityId,
          serviceReportId: prints.serviceReportId,
          keptAt: prints.createdAt,
          number: evidence.number,
          activityTitle: activities.title,
        })
        .from(prints)
        .leftJoin(evidence, eq(evidence.id, prints.evidenceId))
        .leftJoin(serviceReports, eq(serviceReports.id, prints.serviceReportId))
        .leftJoin(activities, eq(activities.id, activityId))
        .where(eq(prints.sha256, sha256))
        .orderBy(prints.createdAt)
        .limit(1)

      if (print !== undefined) {
        if (print.evidenceId !== null && print.number !== null) {
          return {
            kind: 'evidence',
            evidenceId: print.evidenceId,
            activityId: null,
            title: print.number,
            keptAt: print.keptAt.toISOString(),
          }
        }

        if (readsActivities && print.activityTitle !== null) {
          return {
            kind: print.serviceReportId === null ? 'round' : 'service_report',
            evidenceId: null,
            activityId: print.activityId,
            title: print.activityTitle,
            keptAt: print.keptAt.toISOString(),
          }
        }
      }

      const [filed] = await tx
        .select({
          evidenceId: evidenceSignedPrints.evidenceId,
          filedAt: evidenceSignedPrints.filedAt,
          number: evidence.number,
        })
        .from(evidenceSignedPrints)
        .innerJoin(evidence, eq(evidence.id, evidenceSignedPrints.evidenceId))
        .where(eq(evidenceSignedPrints.sha256, sha256))
        .orderBy(desc(evidenceSignedPrints.filedAt))
        .limit(1)

      return filed === undefined
        ? null
        : {
            kind: 'signed_evidence',
            evidenceId: filed.evidenceId,
            activityId: null,
            title: filed.number,
            keptAt: filed.filedAt.toISOString(),
          }
    })
  }
}
