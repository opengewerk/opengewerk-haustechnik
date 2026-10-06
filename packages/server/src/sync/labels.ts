import {
  type Asset,
  type Identity,
  labelAssignmentRefusal,
  type LabelAssignmentRefusal,
} from '@opengewerk/haustechnik-domain'
import {
  type FoundIdentity,
  isUuid,
  labelIsValid,
  type SyncCheck,
  type SyncRefusal,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { assets, labels } from '../database/schema/index.js'

// A label from a sheet, given to an asset on a device (section 4.2 of the
// concept, #99). The rule is the one of `domain` the screen asked before it
// queued anything; asked here again against what the server holds, because a
// second device may have given the label away or labelled the asset
// meanwhile. The database holds the same behind it, for the whole
// transmission: the trigger that keeps a label where it was given, the key
// over the property, and the index of one valid label per asset.

type Check = SyncCheck<FoundIdentity<Identity>>

/**
 * What a refusal is to the device: a label that is blocked takes no change,
 * one that hangs somewhere already and an asset that has its label were
 * settled by somebody else, and an asset of another property is no asset this
 * label could hang on.
 */
const answers: Readonly<Record<LabelAssignmentRefusal, SyncRefusal>> = {
  blocked: { kind: 'conflict', reason: 'record_is_fixed', fields: [] },
  taken: { kind: 'conflict', reason: 'changed_elsewhere', fields: ['assetId'] },
  labelled: { kind: 'conflict', reason: 'changed_elsewhere', fields: ['assetId'] },
  elsewhere: { kind: 'conflict', reason: 'record_missing', fields: ['assetId'] },
}

export const assigned: Check = async ({ tx, operation, values, current }) => {
  if (operation.entity !== 'labels' || operation.kind !== 'update' || !('assetId' in values)) {
    return null
  }

  const assetId = values['assetId']

  // Taking a label off an asset is no change a device makes: it is blocked,
  // and a new one is made.
  if (current === null || !isUuid(assetId)) {
    return answers.taken
  }

  // The asset as the person asking sees it: gone, or in another area, it is
  // not there to be labelled.
  const [asset] = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId as Asset['id']), isNull(assets.deletedAt)))

  if (!asset) {
    return answers.elsewhere
  }

  const [valid] = await tx
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.assetId, asset.id), labelIsValid(labels.blockedAt, labels.deletedAt)))
  const refusal = labelAssignmentRefusal(current, asset, valid !== undefined)

  return refusal === null ? null : answers[refusal]
}
