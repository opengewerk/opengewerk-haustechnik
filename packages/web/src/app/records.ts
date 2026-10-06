import {
  activityKindLabel,
  activityStatusLabel,
  buildingKindLabel,
  countingLabel,
  defectStatusLabel,
  documentKindLabel,
  dutyBasisLabel,
  dutyPerformerLabel,
  evidenceResultLabel,
  lifecycleStateLabel,
  meterUnitSymbol,
  signatureRoleLabel,
  syncEntityNames,
  syncFieldNames,
  type SyncValue,
  workOrderDecisionLabel,
  workOrderKindLabel,
} from '@opengewerk/haustechnik-domain'
import type { RecordWords } from '@opengewerk/platform-web'

import { ownDecision } from './duplicate-decision.js'

/**
 * What the screens of the conflicts say about a record of this application
 * (ADR 0010 in the repository opengewerk): what a kind of record and its
 * fields are called, the name a record goes by, and how a value is written.
 * The names stand in `domain`, where a test of the server holds them against
 * the policies and the schema (#27).
 */

/** The field a record goes by on a screen, the first one it has. */
const titleFields: Readonly<Record<string, readonly string[]>> = {
  properties: ['name'],
  buildings: ['name'],
  floors: ['name'],
  // A room by its number, and by its name where it has none.
  rooms: ['number', 'name'],
  assets: ['name'],
  duties: ['label', 'kind'],
  duty_dismissals: ['kind'],
  activities: ['title'],
  work_orders: ['number'],
  defects: ['description'],
  // A document by its name, a version of one by the name of its file.
  attachments: ['title'],
  attachment_versions: ['fileName'],
}

/**
 * The words of the values of a field, where the field holds one of a list.
 * Three kinds of record share `kind`, and two `status`, with values of their
 * own: an activity is a round or a work order, a work order is for a fault,
 * a document is a manual or a plan, and the words for what two of them have
 * are the same.
 */
const valueWords: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  kind: { ...activityKindLabel, ...workOrderKindLabel, ...documentKindLabel },
  status: { ...activityStatusLabel, ...defectStatusLabel },
  result: evidenceResultLabel,
  state: lifecycleStateLabel,
  meterUnit: meterUnitSymbol,
  basis: dutyBasisLabel,
  performer: dutyPerformerLabel,
  counting: countingLabel,
  role: signatureRoleLabel,
  decision: workOrderDecisionLabel,
}

function wordOf(words: Readonly<Record<string, string>>, value: string): string | null {
  return Object.hasOwn(words, value) ? (words[value] ?? null) : null
}

/**
 * A value the way a screen writes it, or null where it is written as it is.
 * The kinds of a building travel as the text of a list (ADR 0005 in the
 * repository opengewerk) and are written as their words.
 */
function valueText(field: string, value: SyncValue): string | null {
  if (typeof value !== 'string') {
    return null
  }

  if (field === 'kinds') {
    try {
      const kinds = JSON.parse(value) as unknown

      return Array.isArray(kinds)
        ? kinds.map((kind) => wordOf(buildingKindLabel, String(kind)) ?? String(kind)).join(', ')
        : null
    } catch {
      return null
    }
  }

  const words = Object.hasOwn(valueWords, field) ? valueWords[field] : undefined

  return words ? wordOf(words, value) : null
}

export const records: RecordWords = {
  entityLabel: (entity) =>
    (Object.hasOwn(syncEntityNames, entity) ? syncEntityNames[entity] : undefined) ?? entity,
  fieldLabel: (field) =>
    (Object.hasOwn(syncFieldNames, field) ? syncFieldNames[field] : undefined) ?? field,
  titleOf: (entity, record) => {
    const fields = Object.hasOwn(titleFields, entity) ? (titleFields[entity] ?? []) : []
    const named = fields
      .map((field) => record?.[field])
      .find((value) => typeof value === 'string' && value.trim() !== '')

    return typeof named === 'string' ? named : records.entityLabel(entity)
  },
  valueText,
  settledElsewhere: {},
  // A possible duplicate of an asset taken stock of on site is decided in a
  // card of its own, with what was sent beside the asset (#99).
  ownDecision,
}
