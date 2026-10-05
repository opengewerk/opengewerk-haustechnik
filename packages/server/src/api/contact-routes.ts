import { UnprocessableEntityException } from '@nestjs/common'
import { type PropertyId, propertyContacts, type Right } from '@opengewerk/haustechnik-domain'
import { type ContactRights, type ContactRoutes, isUuid } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import type { ContactPlaceColumns } from '../database/schema/contacts.js'
import { contacts, properties } from '../database/schema/index.js'

const missingProperty = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'

/**
 * The rights of the routes of the contacts, which are the property's: whoever
 * sees the properties reads who to talk to there, and whoever keeps the
 * properties keeps their contacts (section 7 of the concept).
 */
export const contactRights: ContactRights<Right> = {
  read: 'location.read',
  create: 'location.write',
  write: 'location.write',
}

/**
 * The people to talk to at a property (#85, section 4.1 of the concept), on
 * the routes of the foundation (ADR 0010 of the repository opengewerk). What
 * a contact hangs on here and where it lies is said here.
 *
 * A contact is made, corrected and taken away with a connection, like the
 * property it hangs on (ADR 0006, point 6); a device holds the contacts of
 * its areas to read and to call from.
 */
export const contactRoutes: ContactRoutes<Right, 'propertyId', ContactPlaceColumns> = {
  table: contacts,
  rules: propertyContacts,
  // The area of a contact is the area of its property, and no request names
  // it. The property has to be there for whoever asks: one that is marked,
  // one of another tenant and one outside the areas of the person are
  // answered alike, the policies decide which rows there are.
  place: async ({ tx, parents }) => {
    if (!('propertyId' in parents)) {
      // A change that leaves the property alone leaves the area alone.
      return undefined
    }

    const id = parents.propertyId
    const [property] =
      typeof id === 'string' && isUuid(id)
        ? await tx
            .select({ areaId: properties.areaId })
            .from(properties)
            .where(and(eq(properties.id, id as PropertyId), isNull(properties.deletedAt)))
        : []

    if (!property) {
      throw new UnprocessableEntityException(missingProperty)
    }

    return { areaId: property.areaId }
  },
}
