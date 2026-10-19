import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common'
import {
  deletionRuleNumbers,
  isProcessingActivity,
  processingActivities,
  type ProcessingRecordView,
  recordText,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import { processingRecordActivities, processingRecordSettings } from '../database/schema/index.js'
import { recordInputsOf } from '../privacy/documents.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/** A text of the request as it is kept, or a 400 with the sentence that says why not. */
function text(body: unknown, field: string, label: string): string | null {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const kept = recordText(record[field], label)

  if (kept !== null && typeof kept === 'object') {
    throw new BadRequestException(kept.problem)
  }

  return kept
}

/**
 * What the Leitung writes for the record of the processing (#358, decided on
 * 19.10.2026): who is responsible and the data protection officer, and for
 * each activity the purpose, the legal basis and the recipients. The proposals
 * of the application stand until the Leitung confirms or changes them; taking
 * a change back makes the proposal stand again. Only whoever makes the
 * documents writes it: "Auskunft, Verfahrensbeschreibung und Verzeichnis
 * erzeugen" for every route.
 *
 * Held by `processing-record.test.ts` against the database.
 */
@Controller('settings/processing-record')
export class ProcessingRecordController {
  constructor(private readonly database: Database) {}

  /** The record as its page shows it: the proposals, what was written, and the rules of the deletion concept. */
  @Get()
  @RequiresPermission('privacy.generate')
  read(@CurrentIdentity() identity: Asking): Promise<ProcessingRecordView> {
    return this.database.forTenant(identity, async (tx) => {
      const inputs = await recordInputsOf(tx)
      const numbers = deletionRuleNumbers()

      return {
        controller: inputs.controller,
        officer: inputs.officer,
        activities: processingActivities.map((activity) => {
          const entry = inputs.activities[activity.key]

          return {
            key: activity.key,
            title: activity.title,
            sections: activity.sections,
            subjects: activity.subjects,
            data: activity.data,
            proposedPurpose: activity.purpose,
            proposedLegalBasis: activity.legalBasis,
            purpose: entry?.purpose ?? null,
            legalBasis: entry?.legalBasis ?? null,
            recipients: entry?.recipients ?? null,
            deletion: activity.deletion.map((key) => numbers[key]),
          }
        }),
      }
    })
  }

  /** Who is responsible and the data protection officer; an empty text is none. */
  @Put()
  @RequiresPermission('privacy.generate')
  async keep(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<ProcessingRecordView> {
    const controller = text(body, 'controller', 'Verantwortlicher')
    const officer = text(body, 'officer', 'Datenschutzbeauftragter')

    await this.database.forTenant(identity, (tx) =>
      tx
        .insert(processingRecordSettings)
        .values({ tenantId: identity.tenantId, controller, officer })
        .onConflictDoUpdate({
          target: processingRecordSettings.tenantId,
          set: { controller, officer, updatedAt: sql`now()` },
        }),
    )

    return this.read(identity)
  }

  /**
   * What the Leitung writes for one activity. A purpose and a legal basis
   * confirm the activity together; both empty, the proposal stands again.
   */
  @Put('activities/:key')
  @RequiresPermission('privacy.generate')
  async keepActivity(
    @CurrentIdentity() identity: Asking,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<ProcessingRecordView> {
    if (!isProcessingActivity(key)) {
      throw new BadRequestException(`Eine Tätigkeit „${key}“ gibt es nicht.`)
    }

    const purpose = text(body, 'purpose', 'Zweck')
    const legalBasis = text(body, 'legalBasis', 'Rechtsgrundlage')
    const recipients = text(body, 'recipients', 'Empfänger')

    if ((purpose === null) !== (legalBasis === null)) {
      throw new BadRequestException(
        'Zweck und Rechtsgrundlage gehören zusammen: beide, oder keines für den Vorschlag der Anwendung.',
      )
    }

    await this.database.forTenant(identity, (tx) =>
      tx
        .insert(processingRecordActivities)
        .values({ tenantId: identity.tenantId, activity: key, purpose, legalBasis, recipients })
        .onConflictDoUpdate({
          target: [processingRecordActivities.tenantId, processingRecordActivities.activity],
          set: { purpose, legalBasis, recipients, updatedAt: sql`now()` },
        }),
    )

    return this.read(identity)
  }
}
