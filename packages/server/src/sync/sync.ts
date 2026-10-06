import { type Catalogue, offlineEditRefusal, offlineRules } from '@opengewerk/haustechnik-domain'
import {
  attachmentVersionFiles,
  recordRulesCheck,
  type ServerSync,
  serverSync,
  type SyncCheck,
  type SyncCheckContext,
  syncTables,
} from '@opengewerk/platform-server'
import { getTableColumns } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

import { assignNumber } from '../database/number-ranges.js'
import * as schema from '../database/schema/index.js'
import { unseenDuplicate } from './duplicates.js'
import { assigned } from './labels.js'
import { placed } from './places.js'
import { recordRules } from './record-rules.js'
import { followed, type Sender, signed } from './signatures.js'

// The sync on the server is the foundation's (ADR 0010 in the repository
// opengewerk): applying an operation, recording what became of it, the pull
// by change sequence and the conflicts. What this application adds is in
// here: its rules and tables, the questions it asks of an operation before
// the database does, in the order they are asked, and the numbers the server
// draws (ADR 0006), and what follows a signature once it is written. The
// routes a device syncs through are bound in `api/sync-routes.ts`.

type Check = SyncCheck<Sender>

/**
 * A field a device may not write without a connection (`offlineEdits`): a
 * conflict about this one operation, `online_only` with the fields, and not
 * the refusal of the transmission. A form asks the same before it queues
 * anything; an operation that gets here anyway was queued by a device whose
 * rules were wider, before the rule became stricter, and it must not hold up
 * the outbox behind it (ADR 0006, point 6).
 */
const offline: Check = ({ operation }) => {
  const refused = offlineEditRefusal(operation)

  return refused === null ? null : { kind: 'conflict', reason: 'online_only', fields: refused }
}

/**
 * Every text the way a route takes it: trimmed, and an empty one stored as
 * nothing where the column may be empty. The checks in the database hold a
 * text to its trimmed form and an optional one to more than nothing; a form
 * that left a space at the end would otherwise take the whole transmission
 * down with it.
 */
const normalised: Check = ({ table, values }) => {
  const columns = getTableColumns(table) as Record<string, PgColumn>

  for (const [field, value] of Object.entries(values)) {
    if (typeof value !== 'string') {
      continue
    }

    const trimmed = value.trim()

    values[field] = trimmed === '' && columns[field]?.notNull === false ? null : trimmed
  }

  return null
}

/**
 * A version of a document names its file by tenant and hash, a key the check
 * of the place does not read. Its own question, asked before the place: is
 * the file there, sent ahead of the version, and is the size the one it has.
 * A file that never arrived is a conflict about this one version, and not the
 * refusal of everything a device sent with it.
 */
const versionFile: Check = attachmentVersionFiles()

/**
 * What the server puts in on the way to the database (ADR 0006, point 8): the
 * number of an asset or a work order made on a device, drawn here as the
 * route draws it for one made over it, in the same transaction as the insert,
 * so that a transmission refused afterwards takes the number back with it;
 * and who gave a signature, the person signed in and never what a device
 * says (ADR 0004, addendum on the signature).
 */
async function completed({
  tx,
  tenantId,
  operation,
  values,
  sender,
}: SyncCheckContext<Sender>): Promise<Record<string, unknown>> {
  if (operation.kind !== 'create') {
    return values
  }

  if (operation.entity === 'activity_signatures') {
    return { ...values, signedBy: sender.userId }
  }

  if (operation.entity === 'assets') {
    return { ...values, number: await assignNumber(tx, tenantId, 'asset', new Date()) }
  }

  if (operation.entity === 'work_orders') {
    return { ...values, number: await assignNumber(tx, tenantId, 'work_order', new Date()) }
  }

  return values
}

/**
 * The sync on the server of this application, with the catalogue the asset
 * kinds come from. The tables are those of the schema module itself: the pull
 * reads every one with the columns of the sync, and a test holds each of them
 * to a policy.
 *
 * The order of the checks is behaviour, the first that refuses answers: what
 * may not be written without a connection, then the texts in their form, the
 * rules of `domain` on the fields, the file of a version, the place, the
 * question that reads other records and puts in what the server derives,
 * then an asset against the ones that are there and a label against the asset
 * it is given to, and last a signature against its activity.
 */
export function syncFor(catalogue: Catalogue): ServerSync<Sender> {
  return serverSync<Sender>({
    rules: offlineRules,
    tables: syncTables(schema),
    checks: [
      offline,
      normalised,
      recordRulesCheck(recordRules(catalogue)),
      versionFile,
      placed,
      unseenDuplicate,
      assigned,
      signed,
    ],
    complete: completed,
    afterWrite: followed(catalogue),
  })
}
