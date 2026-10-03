import {
  activityDutyProblems,
  activityProblems,
  assetProblems,
  assetValueProblems,
  type Catalogue,
  defectProblems,
  meterProblems,
  placeTargetProblem,
  roomProblems,
  supplyPlaceProblem,
  workOrderProblems,
} from '@opengewerk/haustechnik-domain'
import type { RecordRule, RecordRules } from '@opengewerk/platform-server'

import { dayInGermany } from '../today.js'

// Whose mistake a broken rule is, a conflict or a refusal of the whole
// transmission, is the foundation's and the same for every application (ADR
// 0010 in the repository opengewerk, `recordRuleRefusal`). The rules are this
// application's, each the function of `domain` its form asks before anything
// is queued (ADR 0006, point 11), so that a device and the server give the
// same answer. Left to the database, every one of them refused the whole
// transmission with a sentence nobody on site could act on.

type ProblemsOf = (record: Readonly<Record<string, unknown>>) => Readonly<Record<string, string>>

/**
 * A rule over some fields of a record, as `problems` says it: the first
 * sentence it has for one of them, judged on the record as it would stand.
 *
 * A field the operation leaves out is not given and not asked about, as in a
 * form that changes other fields; on a record that is made, a field it cannot
 * be made without counts as empty. One rule per field where a sentence
 * belongs to one field, so that a device that writes a name too long is told
 * so, and one over the pair where the sentence is about two.
 */
function rule(problems: ProblemsOf, fields: readonly string[], needed: readonly string[] = []) {
  return {
    fields,
    problem: (at) => {
      const record = Object.fromEntries(
        fields.map((name) => [name, at(name) ?? (needed.includes(name) ? null : undefined)]),
      )
      const found = problems(record)

      return fields.map((name) => found[name]).find((sentence) => sentence !== undefined) ?? null
    },
  } satisfies RecordRule
}

/** One rule for each field, the ones a record cannot be made without named. */
function each(problems: ProblemsOf, fields: readonly string[], needed: readonly string[] = []) {
  return fields.map((name) => rule(problems, [name], needed))
}

/** A value of JSON as the record holds it: read out of its text where the row gave text. */
function json(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/**
 * The rules of the records a device writes, with the catalogue the asset
 * kinds come from: whether an asset's kind is one a package knows today, and
 * whether its values and its meter fit that kind, as the route that takes an
 * asset in asks them.
 *
 * A kind and its values are one rule: a device that changes the values alone
 * wrote them for the kind it saw, and if they no longer fit, somebody changed
 * the kind meanwhile.
 */
export function recordRules(catalogue: Catalogue): RecordRules {
  const kindOf = (key: unknown) =>
    typeof key === 'string' ? (catalogue.assetKind(key, dayInGermany())?.definition ?? null) : null
  const unknownKind = (key: unknown) =>
    `Die Anlagenart ${String(key)} kennt kein Paket des Katalogs.`

  return {
    rooms: [
      ...each(roomProblems, ['number', 'name', 'use']),
      // A number or a name, and nothing given counts as neither.
      rule(roomProblems, ['number', 'name'], ['number', 'name']),
    ],
    assets: [
      ...each(
        assetProblems,
        [
          'kind',
          'name',
          'mark',
          'manufacturer',
          'model',
          'serialNumber',
          'yearBuilt',
          'commissionedOn',
          'warrantyEndsOn',
          'meterNumber',
          'meterUnit',
        ],
        ['kind', 'name'],
      ),
      {
        fields: ['kind', 'values'],
        problem: (at) => {
          const kind = kindOf(at('kind'))

          if (!kind) {
            return unknownKind(at('kind'))
          }

          // Left out on a record that is made, the column gives no values.
          const values = at('values') === undefined ? {} : json(at('values'))

          return Object.values(assetValueProblems(kind, values))[0] ?? null
        },
      },
      {
        fields: ['kind', 'meterNumber', 'meterUnit'],
        problem: (at) => {
          const kind = kindOf(at('kind'))

          if (!kind) {
            return unknownKind(at('kind'))
          }

          const found = meterProblems(kind, {
            meterNumber: at('meterNumber') ?? null,
            meterUnit: at('meterUnit') ?? null,
          })

          return found['meterNumber'] ?? found['meterUnit'] ?? null
        },
      },
    ],
    asset_supplies: [
      {
        fields: ['buildingId', 'roomId'],
        problem: (at) => supplyPlaceProblem({ buildingId: at('buildingId'), roomId: at('roomId') }),
      },
    ],
    activities: [
      ...each(activityProblems, ['kind', 'title', 'status', 'performedOn'], ['kind', 'title']),
      rule(activityProblems, ['status', 'closingReason']),
      {
        fields: ['assetId', 'roomId', 'buildingId'],
        problem: (at) =>
          placeTargetProblem(
            { assetId: at('assetId'), roomId: at('roomId'), buildingId: at('buildingId') },
            'Ein Vorgang',
          ),
      },
    ],
    activity_duties: [
      ...each(activityDutyProblems, ['result', 'resultReason']),
      rule(activityDutyProblems, ['result', 'resultReason']),
    ],
    work_orders: each(workOrderProblems, ['kind'], ['kind']),
    defects: [
      ...each(
        defectProblems,
        ['description', 'defectClass', 'foundOn'],
        ['description', 'foundOn'],
      ),
      {
        fields: ['assetId', 'roomId', 'buildingId'],
        problem: (at) =>
          placeTargetProblem(
            { assetId: at('assetId'), roomId: at('roomId'), buildingId: at('buildingId') },
            'Ein Mangel',
          ),
      },
    ],
  }
}
