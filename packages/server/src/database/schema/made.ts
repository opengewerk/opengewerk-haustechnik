import { attachmentsSchema, contactsSchema, deadlinesSchema } from '@opengewerk/platform-server'
import {
  attachmentsGuard,
  attachmentVersionsGuard,
  contactsGuard,
  deadlinesGuard,
  type MadeByTheApplication,
  numberRangesGuard,
  secretsGuard,
} from '@opengewerk/platform-server/migration'

import { numberRangeKey, numberRanges } from './number-ranges.js'
import { secretPurpose, secrets } from './secrets.js'

/**
 * The deadlines as the foundation makes them, without what this application
 * gives them for the duty, its property and its area: a database of the
 * building blocks has none of those. `foundation.test.ts` names them as its
 * own, the policy of the areas with them.
 */
const deadlinesOfTheBlocks = deadlinesSchema()

/**
 * The contacts as the foundation makes them, without the property and the
 * area this application hangs them on, and without the bounds of their texts.
 */
const contactsOfTheBlocks = contactsSchema()

/**
 * The documents and their versions as the foundation makes them, without what
 * this application hangs a document on, its kind, the bound of its name and
 * the line between the areas on both tables.
 */
const attachmentsOfTheBlocks = attachmentsSchema()

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
  schema: {
    numberRangeKey,
    numberRanges,
    secretPurpose,
    secrets,
    deadlineStatus: deadlinesOfTheBlocks.deadlineStatus,
    deadlines: deadlinesOfTheBlocks.deadlines,
    contacts: contactsOfTheBlocks.contacts,
    attachments: attachmentsOfTheBlocks.attachments,
    attachmentVersions: attachmentsOfTheBlocks.attachmentVersions,
  },
  guards: [
    numberRangesGuard,
    secretsGuard,
    deadlinesGuard,
    contactsGuard,
    attachmentsGuard,
    attachmentVersionsGuard,
  ],
}
