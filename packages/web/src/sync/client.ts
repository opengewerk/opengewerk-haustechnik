import { offlineRules } from '@opengewerk/haustechnik-domain'
import { SyncClient as Mechanism, type SyncStart } from '@opengewerk/platform-web/sync'

/**
 * The sync client of this application.
 *
 * The client itself is the foundation's (ADR 0010 in the repository
 * opengewerk) and knows no record of this application. What makes it this
 * application's is what it is started with: the rules made from its policies,
 * so that a device judges a change as the server will.
 *
 * Bound here once, so that every screen and every test that starts a client
 * starts this one, and none can start one that decides by other rules.
 */
export type SyncClient = Mechanism

export const SyncClient = {
  start(options: Omit<SyncStart, 'rules'>): Promise<SyncClient> {
    return Mechanism.start({ ...options, rules: offlineRules })
  },
}
