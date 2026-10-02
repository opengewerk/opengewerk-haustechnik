import {
  type MadeByTheApplication,
  numberRangesGuard,
  secretsGuard,
} from '@opengewerk/platform-server/migration'

import { numberRangeKey, numberRanges } from './number-ranges.js'
import { secretPurpose, secrets } from './secrets.js'

/**
 * The tables of the foundation this application makes with lists of its own:
 * their columns and rules are the foundation's, the values of their enums are
 * this application's.
 *
 * Described once here, for the tool that completes the first migration and
 * for the comparison of this database with the building blocks of the
 * foundation. Not part of what `index.ts` hands to drizzle-kit: this is a
 * description and no table.
 *
 * The settings of a tenant with the day they apply from are not among them
 * yet. That table is made from a list of settings as well, and this
 * application has none so far; it arrives with the first one, in the
 * migration that brings it.
 */
export const madeWithLists: MadeByTheApplication = {
  schema: { numberRangeKey, numberRanges, secretPurpose, secrets },
  guards: [numberRangesGuard, secretsGuard],
}
