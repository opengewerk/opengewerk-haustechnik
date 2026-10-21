import {
  type DeletionFacts,
  deletionRuleNumbers,
  describeDeletion,
  describeMeasures,
  describeRecord,
  isProcessingActivity,
  type PrivacyDocumentKind,
  type ProcessingActivityEntry,
  processingActivities,
  type ProcessingRecordInputs,
  closedActivitiesStayDays,
  holdsForInWords,
  processingHoldsFor,
} from '@opengewerk/haustechnik-domain'
import {
  type Database,
  readMeasures,
  sessionLifetimes,
  type TenantTransaction,
} from '@opengewerk/platform-server'

import { processingRecordActivities, processingRecordSettings } from '../database/schema/index.js'
import { keeperOf } from '../labels/faces.js'
import { removalDaysOf } from '../memberships/end.js'
import { giveUpAfterMs } from '../notifications/outside-answers.js'
import { madeAtInWords } from '../api/processing-descriptions.controller.js'
import { recordRetentionOf } from '../api/record-retention.controller.js'
import { minimumYearsOf } from '../api/retention.controller.js'
import { processingTemplate } from '../processing-description/template.js'
import { measuresTemplate } from './template.js'

/** What the Leitung wrote for the record, out of its two tables. */
export async function recordInputsOf(tx: TenantTransaction): Promise<ProcessingRecordInputs> {
  const [settings] = await tx
    .select({
      controller: processingRecordSettings.controller,
      officer: processingRecordSettings.officer,
    })
    .from(processingRecordSettings)
  const rows = await tx
    .select({
      activity: processingRecordActivities.activity,
      purpose: processingRecordActivities.purpose,
      legalBasis: processingRecordActivities.legalBasis,
      recipients: processingRecordActivities.recipients,
    })
    .from(processingRecordActivities)
  const activities: Partial<Record<string, ProcessingActivityEntry>> = {}

  for (const row of rows) {
    // A row of an activity the application no longer knows stays out of the record.
    if (isProcessingActivity(row.activity)) {
      activities[row.activity] = {
        purpose: row.purpose,
        legalBasis: row.legalBasis,
        recipients: row.recipients,
      }
    }
  }

  return {
    controller: settings?.controller ?? null,
    officer: settings?.officer ?? null,
    activities,
  }
}

/** What the rules of the deletion concept take from the operator, the instance and the code. */
export async function deletionFactsOf(
  database: Database,
  tx: TenantTransaction,
): Promise<DeletionFacts> {
  const instance = await readMeasures(database)
  const generations = instance.measures.backupGenerations

  return {
    minimumYears: await minimumYearsOf(tx),
    recordYears: await recordRetentionOf(tx),
    removalDays: await removalDaysOf(tx),
    sessionHours: sessionLifetimes.ordinary / 3600,
    deviceDays: sessionLifetimes.registeredDevice / 86_400,
    deviceStoreDays: closedActivitiesStayDays,
    outsideAnswerDays: giveUpAfterMs / 86_400_000,
    backupGenerations: typeof generations === 'string' ? generations : null,
  }
}

/** The version the documents hold for: the one the description of the processing names. */
export const holdsFor = () => processingHoldsFor(processingTemplate())

/** A document of the kind as it would be made now, at the moment given in words. */
export async function madePrivacyDocument(
  database: Database,
  tx: TenantTransaction,
  kind: PrivacyDocumentKind,
  at: string,
): Promise<string> {
  const operator = await keeperOf(tx)

  switch (kind) {
    case 'record':
      return describeRecord({
        operator,
        at,
        holdsFor: holdsFor(),
        inputs: await recordInputsOf(tx),
        ruleNumbers: deletionRuleNumbers(),
      })
    case 'measures': {
      const instance = await readMeasures(database)

      return describeMeasures(measuresTemplate(), {
        operator,
        at,
        holdsFor: holdsFor(),
        measures: instance.measures,
        subprocessors: instance.subprocessors,
        changedAt: instance.changedAt === null ? null : madeAtInWords(new Date(instance.changedAt)),
      })
    }
    case 'deletion':
      return describeDeletion({
        operator,
        at,
        holdsFor: holdsFor(),
        facts: await deletionFactsOf(database, tx),
      })
  }
}

/** What the screen says of each kind, as label and value. */
export async function documentFacts(
  database: Database,
  tx: TenantTransaction,
  kind: PrivacyDocumentKind,
): Promise<readonly { readonly label: string; readonly value: string }[]> {
  switch (kind) {
    case 'record': {
      const inputs = await recordInputsOf(tx)
      const confirmed = processingActivities.filter(
        (activity) => inputs.activities[activity.key]?.purpose != null,
      ).length

      return [
        {
          label: 'Verantwortlicher',
          value: inputs.controller?.replace(/\n/g, ', ') ?? 'noch nicht angegeben',
        },
        {
          label: 'Datenschutzbeauftragter',
          value: inputs.officer?.replace(/\n/g, ', ') ?? 'keiner angegeben',
        },
        {
          label: 'Tätigkeiten',
          value: `${String(processingActivities.length)}, davon ${String(confirmed)} bestätigt und ${String(processingActivities.length - confirmed)} als Vorschlag der Anwendung`,
        },
      ]
    }
    case 'measures': {
      const instance = await readMeasures(database)

      return [
        { label: 'Teil A', value: `aus der Anwendung, ${holdsForInWords(holdsFor())}` },
        {
          label: 'Teil B',
          value:
            instance.changedAt === null
              ? 'noch nicht ausgefüllt'
              : `von der Verwaltung der Instanz, zuletzt geändert am ${madeAtInWords(new Date(instance.changedAt)).slice(0, 10)}`,
        },
        {
          label: 'Unterauftragsverarbeiter',
          value:
            instance.subprocessors.length === 0
              ? 'keine eingetragen'
              : String(instance.subprocessors.length),
        },
      ]
    }
    case 'deletion': {
      const facts = await deletionFactsOf(database, tx)

      return [
        {
          label: 'Nachweise mindestens aufbewahren',
          value:
            facts.minimumYears === null
              ? 'keine Zahl von Jahren; es gilt die Regel der Pflichtart'
              : `${String(facts.minimumYears)} ${facts.minimumYears === 1 ? 'Jahr' : 'Jahre'}, länger, wo die Regel der Pflichtart es sagt`,
        },
        {
          label: 'Angaben eines beendeten Zugangs',
          value: `nach ${String(facts.removalDays)} Tagen entfernen`,
        },
        {
          label: 'Sicherungen',
          value:
            facts.backupGenerations === null
              ? 'nach der Vorgabe vierzehn Generationen'
              : `${facts.backupGenerations} Generationen, laut Verwaltung der Instanz`,
        },
      ]
    }
  }
}
