import {
  attachmentsSchema,
  contactsSchema,
  deadlinesSchema,
  electricalSchema,
  photovoltaicSchema,
} from '@opengewerk/platform-server'
import {
  attachmentsGuard,
  attachmentVersionsGuard,
  contactsGuard,
  deadlinesGuard,
  type MadeByTheApplication,
  type TableGuard,
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
 * The electrical structure as the foundation makes it (ADR 0014 in the
 * repository opengewerk), without the asset, the property and the area this
 * application hangs every part on (#349): so that a change of the building
 * block in the foundation, which every application has to follow with a
 * migration of its own, shows here.
 */
const electricalOfTheBlocks = electricalSchema()

/**
 * The PV structure as the foundation makes it, without the place this
 * application hangs every part on and where an inverter hangs (#461), for the
 * same reason.
 */
const photovoltaicOfTheBlocks = photovoltaicSchema()

/**
 * What the tables of both structures need beside their columns, as
 * migrations 0092 and 0094 say it: the application reads, adds and changes a
 * part and removes none, the log watches them and they travel. The foundation
 * brings no description of its own for them, as an application makes a
 * structure only once it needs it.
 */
const structureGuards: readonly TableGuard[] = [
  'distribution_boards',
  'board_sections',
  'circuits',
  'equipment',
  'inverters',
  'pv_strings',
  'pv_modules',
].map((table) => ({ table, grants: ['select', 'insert', 'update'], audited: true, synced: true }))

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
    distributionBoardKind: electricalOfTheBlocks.distributionBoardKind,
    overcurrentDevice: electricalOfTheBlocks.overcurrentDevice,
    tripCharacteristic: electricalOfTheBlocks.tripCharacteristic,
    rcdType: electricalOfTheBlocks.rcdType,
    cableInstallationMethod: electricalOfTheBlocks.cableInstallationMethod,
    distributionBoards: electricalOfTheBlocks.distributionBoards,
    boardSections: electricalOfTheBlocks.boardSections,
    circuits: electricalOfTheBlocks.circuits,
    equipment: electricalOfTheBlocks.equipment,
    inverters: photovoltaicOfTheBlocks.inverters,
    pvStrings: photovoltaicOfTheBlocks.pvStrings,
    pvModules: photovoltaicOfTheBlocks.pvModules,
  },
  guards: [
    numberRangesGuard,
    secretsGuard,
    deadlinesGuard,
    contactsGuard,
    attachmentsGuard,
    attachmentVersionsGuard,
    ...structureGuards,
  ],
}
