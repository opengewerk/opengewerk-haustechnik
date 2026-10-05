import { offlineRules } from '@opengewerk/haustechnik-domain'
import { SyncClient as Mechanism, type SyncStart } from '@opengewerk/platform-web/sync'

import { catalogueKeep } from './catalogue.js'

/**
 * The sync client of this application.
 *
 * The client itself is the foundation's (ADR 0010 in the repository
 * opengewerk) and knows no record of this application. What makes it this
 * application's is what it is started with: the rules made from its policies,
 * so that a device judges a change as the server will, and the one thing a
 * device keeps for itself beside its records, the catalogue of its server
 * (`catalogue.ts`).
 *
 * Bound here once, so that every screen and every test that starts a client
 * starts this one, and none can start one that decides by other rules or has
 * no place for the catalogue.
 */
export type SyncClient = Mechanism

export const SyncClient = {
  start(options: Omit<SyncStart, 'rules' | 'keeps'>): Promise<SyncClient> {
    return Mechanism.start({ ...options, rules: offlineRules, keeps: [catalogueKeep] })
  },
}
