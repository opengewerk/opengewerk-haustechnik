import {
  type Identity,
  offlineRules,
  type Right,
  syncEntities,
} from '@opengewerk/haustechnik-domain'
import {
  type FoundIdentity,
  serverSync,
  type SyncRoutes,
  syncTables,
} from '@opengewerk/platform-server'

import * as schema from '../database/schema/index.js'
import { answerFor } from './database-errors.js'

// The routes a device syncs through are the foundation's (ADR 0010 in the
// repository opengewerk): reading an outbox, refusing one over an operation
// and naming it, the pull and the conflicts. What this application hands them
// is in here: its rules and tables, the right each operation asks for, and its
// words for a refusal of the database.

/**
 * The tables that travel: those of the schema module with a policy. A table
 * carries the columns of the sync from its first migration, and the pull reads
 * every table that has them; without this a table would travel before its
 * rules say what a device may do with it and which device holds which rows
 * (#27). The places carry the columns since #18 and stay on the server until
 * then.
 */
export function travellingTables(
  all: ReturnType<typeof syncTables>,
  entities: readonly string[],
): ReturnType<typeof syncTables> {
  return new Map([...all].filter(([entity]) => entities.includes(entity)))
}

/**
 * The sync on the server of this application: its rules, made from its
 * policies, and the tables of its schema module that have one, so that a
 * table that comes to travel is found without a second list. No record
 * travels yet (#27): the rules know no entity.
 */
export const sync = serverSync<FoundIdentity<Identity>>({
  rules: offlineRules,
  tables: travellingTables(syncTables(schema), syncEntities),
})

/**
 * What an operation needs beyond the right to sync at all, or nothing for an
 * entity this application does not sync, which refuses the transmission with
 * the operation named. Every entity is such a one until its policy arrives,
 * each with the right it asks for (#27).
 */
export function permissionFor(): Right | null {
  return null
}

/**
 * The routes of the sync of this application. Every device holds everything
 * of its tenant there is to hold, which is nothing yet; the choice per device
 * by area arrives with the records (#27, ADR 0006).
 */
export const syncRoutes: SyncRoutes<Identity, Right> = { sync, permissionFor, answerFor }
