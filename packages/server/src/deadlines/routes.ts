import type { ApplicationDeadlineKind } from '@opengewerk/haustechnik-domain'
import type { DeadlineRules } from '@opengewerk/platform-server'

import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import { deadlines } from '../database/schema/index.js'
import { deadlineKindRegistry } from './registry.js'

/**
 * What this application says about its deadlines, for the routes of the
 * foundation under `/deadlines` and `/settings/deadlines`: its table and
 * kinds, the duty and the property an entry hangs on, and the sentence for a
 * person who does not work for the operator. Nothing follows a change of a
 * deadline: a reminder makes nothing that would have to follow it.
 */
export const deadlineRules: DeadlineRules<ApplicationDeadlineKind, ApplicationDeadlineColumns> = {
  table: deadlines,
  registry: deadlineKindRegistry,
  describe: () =>
    Promise.resolve((row) => ({
      dutyId: row.dutyId,
      propertyId: row.propertyId,
    })),
  sentences: {
    notAColleague: 'Verantwortlich ist jemand, der für diesen Betreiber arbeitet.',
  },
}
