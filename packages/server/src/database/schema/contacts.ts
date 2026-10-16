import { contactLimits } from '@opengewerk/haustechnik-domain'
import { contactsSchema, reference } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index } from 'drizzle-orm/pg-core'

import { withinAreasOrABuilding } from './areas.js'
import { contractors } from './contractors.js'
import { optionalTrimmed, properties, trimmed } from './locations.js'

/**
 * What a contact of this application hangs on: its property, with the area of
 * that property, so that a contact stays in the areas of the person who asks,
 * like every row with a place (ADR 0003); or a contractor of the operator
 * (#328), with neither property nor area, as the contractor has none.
 */
const contactPlace = {
  propertyId: reference<'property'>('property_id'),
  areaId: reference<'area'>('area_id'),
  contractorId: reference<'contractor'>('contractor_id'),
}

/** The columns this application gives its contacts, for the routes of the foundation. */
export type ContactPlaceColumns = typeof contactPlace

/**
 * The people to talk to at a property (#85, section 4.1 of the concept): the
 * table of the foundation (ADR 0010 in the repository opengewerk) with the
 * property and its area, the key over the property with ON UPDATE CASCADE, and
 * the restrictive policy `within_areas`, which the comparison with the
 * building blocks takes as this application's own (`foundation.test.ts`).
 *
 * A contact hangs on a property or on a contractor, exactly one of the two,
 * and has an area exactly when it has a property, which the check
 * `contacts_at_a_property_or_a_contractor` holds (ADR 0003, addendum of
 * #328). The texts are kept the way a route hands them over, trimmed and no
 * longer than `contactLimits`.
 *
 * The rows travel to a device, to read and to call from. Deleting marks a
 * row, and a property that is marked takes its contacts along, by a trigger
 * of the migration.
 */
export const { contacts } = contactsSchema({
  columns: contactPlace,
  constraints: (table) => [
    // Seen also by whoever holds only the area of a building on the property (#306).
    // A contact of a contractor lies in no area: whoever is in the operator reads it (#328).
    ...withinAreasOrABuilding('contacts', 'property_id', true),
    foreignKey({
      columns: [table.tenantId, table.contractorId],
      foreignColumns: [contractors.tenantId, contractors.id],
      name: 'contacts_of_a_contractor',
    }),
    check(
      'contacts_at_a_property_or_a_contractor',
      sql`num_nonnulls(${table.propertyId}, ${table.contractorId}) = 1 and (${table.areaId} is null) = (${table.propertyId} is null)`,
    ),
    index('contacts_contractor_idx').on(table.tenantId, table.contractorId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'contacts_follow_their_property',
    }).onUpdate('cascade'),
    index('contacts_property_idx').on(table.tenantId, table.propertyId),
    check('contacts_given_name_shaped', optionalTrimmed(table.givenName, contactLimits.givenName)),
    check('contacts_family_name_shaped', trimmed(table.familyName, contactLimits.familyName)),
    check('contacts_role_shaped', optionalTrimmed(table.role, contactLimits.role)),
    check('contacts_phone_shaped', optionalTrimmed(table.phone, contactLimits.phone)),
    check('contacts_email_shaped', optionalTrimmed(table.email, contactLimits.email)),
  ],
})
