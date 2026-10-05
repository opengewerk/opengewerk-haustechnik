import { contactLimits } from '@opengewerk/haustechnik-domain'
import { contactsSchema, reference } from '@opengewerk/platform-server'
import { check, foreignKey, index } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { optionalTrimmed, properties, trimmed } from './locations.js'

/**
 * What a contact of this application hangs on: its property, with the area of
 * that property, so that a contact stays in the areas of the person who asks,
 * like every row with a place (ADR 0003).
 */
const contactPlace = {
  propertyId: reference<'property'>('property_id').notNull(),
  areaId: reference<'area'>('area_id').notNull(),
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
 * A contact hangs on a property and on nothing else, so the column is the
 * whole of "exactly one parent": it cannot be empty. The texts are kept the
 * way a route hands them over, trimmed and no longer than `contactLimits`.
 *
 * The rows travel to a device, to read and to call from. Deleting marks a
 * row, and a property that is marked takes its contacts along, by a trigger
 * of the migration.
 */
export const { contacts } = contactsSchema({
  columns: contactPlace,
  constraints: (table) => [
    withinAreas(),
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
