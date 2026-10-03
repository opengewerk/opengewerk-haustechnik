import { type SyncPolicy, syncRules } from '@opengewerk/platform-domain'

/**
 * What a device may create and change of each kind of record, and what it
 * holds (ADR 0006).
 *
 * No record of this application travels yet. The policies arrive with the
 * records they govern (#27), each with a test that holds every synced table to
 * a policy and every policy to a table; until then a device keeps and sends
 * nothing, and the bar of the sync still says whether it reaches the server.
 */
export const syncPolicies: Readonly<Record<string, SyncPolicy>> = {}

/**
 * The rules the server and every device decide by, made once from the
 * policies: so that a device works out the answer the server will give.
 */
export const offlineRules = syncRules(syncPolicies)

/** The kinds of record a device keeps, in the order of the policies. */
export const syncEntities = offlineRules.entities
