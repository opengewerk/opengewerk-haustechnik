import { Body, ConflictException, Controller, Inject, Param, Post } from '@nestjs/common'
import {
  type Catalogue,
  type EvidenceLink,
  type EvidenceResult,
  type IsoDate,
  type Report,
  reportProblems,
} from '@opengewerk/haustechnik-domain'
import { accountsOf, CurrentIdentity, Database } from '@opengewerk/platform-server'

import { CATALOGUE } from '../catalogue.js'
import { duties } from '../database/schema/index.js'
import { writeReport } from '../evidence/report.js'
import { EvidenceRefusal } from '../evidence/write.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diese Pflicht gibt es nicht oder nicht mehr.'

/** What stands for a person whose account is not there any more. */
const unknownAccount = 'Unbekanntes Konto'

/** A text as it is kept: trimmed, and nothing where nothing was said. */
function said(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** The report as the body says it, once nothing is wrong with it. */
function reportOf(values: Readonly<Record<string, unknown>>): Report {
  const file = values['file'] as Readonly<Record<string, unknown>>
  const defects = (values['defects'] ?? []) as readonly Readonly<Record<string, unknown>>[]

  return {
    performedOn: values['performedOn'] as IsoDate,
    result: values['result'] as EvidenceResult,
    resultReason: said(values['resultReason']),
    examiner: said(values['examiner']) ?? '',
    examinerOrganisation: said(values['examinerOrganisation']) ?? '',
    file: {
      sha256: file['sha256'] as string,
      fileName: said(file['fileName']) ?? '',
      sizeBytes: file['sizeBytes'] as number,
      previewSha256: said(file['previewSha256']),
    },
    defects: defects.map((defect) => ({
      description: said(defect['description']) ?? '',
      defectClass: said(defect['defectClass']),
      dueOn: said(defect['dueOn']),
    })),
  }
}

/**
 * The report of a contractor or an inspection body, entered in the office as
 * the evidence of a duty (section 4.4 of the concept, #110). Entering it is
 * entering evidence, which section 7 gives to Leitung, Technische Leitung
 * and Objektleitung and not to whoever only performs; the duty is one the
 * person sees. The file went up ahead of it, under the right to file a
 * document that every role has, and the report names it by its hash.
 */
@Controller('duties')
export class DutyReportController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Post(':id/report')
  @RequiresPermission('evidence.write')
  async report(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<EvidenceLink> {
    const values = fieldsOf(
      body,
      [
        'performedOn',
        'result',
        'resultReason',
        'examiner',
        'examinerOrganisation',
        'file',
        'defects',
      ],
      ['resultReason'],
    )

    refuse(
      reportProblems(values, dayInGermany(), (key) => this.catalogue.defectClass(key) !== null),
    )

    const report = reportOf(values)
    // Accounts are read on the instance and never inside a tenant.
    const accounts = await accountsOf(this.database, [identity.userId], identity.userId)

    return this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<typeof duties.$inferSelect>(tx, duties, id, missing)

      try {
        const written = await writeReport(
          tx,
          {
            tenantId: identity.tenantId,
            writtenBy: identity.userId,
            at: new Date(),
            catalogue: this.catalogue,
            nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
          },
          duty.id,
          report,
        )

        return { id: written.id, number: written.number }
      } catch (error) {
        throw error instanceof EvidenceRefusal ? new ConflictException(error.message) : error
      }
    })
  }
}
