import { UnprocessableEntityException } from '@nestjs/common'
import {
  type ContractorId,
  operatorContacts,
  type PropertyId,
  type Right,
} from '@opengewerk/haustechnik-domain'
import { type ContactRights, type ContactRoutes, isUuid } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import type { ContactPlaceColumns } from '../database/schema/contacts.js'
import { contacts, contractors, properties } from '../database/schema/index.js'

const missingProperty = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'
const missingContractor = 'Diese Fremdfirma gibt es nicht oder nicht mehr.'

/** Whether a field of a request names something: an id, not empty and not null. */
function named(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

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
 * The people to talk to at a property (#85, section 4.1 of the concept) and at
 * a contractor (#328, 4.11), on the routes of the foundation (ADR 0010 of the
 * repository opengewerk). What a contact hangs on here and where it lies is
 * said here. The people of a firm are kept by whoever keeps the firms and
 * read by whoever sees them, on top of the rights of the routes.
 *
 * A contact is made, corrected and taken away with a connection, like the
 * property it hangs on (ADR 0006, point 6); a device holds the contacts of
 * its areas to read and to call from.
 */
export const contactRoutes: ContactRoutes<
  Right,
  'propertyId' | 'contractorId',
  ContactPlaceColumns
> = {
  table: contacts,
  rules: operatorContacts,
  parentRight: (field) => (field === 'contractorId' ? 'contractor.write' : null),
  parentReadRight: (field) => (field === 'contractorId' ? 'contractor.read' : null),
  // The area of a contact is the area of its property, and no request names
  // it. The property has to be there for whoever asks: one that is marked,
  // one of another tenant and one outside the areas of the person are
  // answered alike, the policies decide which rows there are. A contact of a
  // contractor has no area, as the firm has none (#328).
  place: async ({ tx, parents }) => {
    if (named(parents.contractorId)) {
      const id = parents.contractorId
      const [firm] = isUuid(id)
        ? await tx
            .select({ id: contractors.id })
            .from(contractors)
            .where(and(eq(contractors.id, id as ContractorId), isNull(contractors.deletedAt)))
        : []

      if (!firm) {
        throw new UnprocessableEntityException(missingContractor)
      }

      return { areaId: null }
    }

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
