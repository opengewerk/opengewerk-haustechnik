import { contractorLimits, contractorServices } from '@opengewerk/haustechnik-domain'
import { primaryId, syncColumns, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { optionalTrimmed, trimmed } from './locations.js'

/**
 * The contractors of an operator (#328, section 4.11 of the concept): a firm
 * with its address, the cost groups it works in and a note. It belongs to the
 * operator and lies in no area (2.8), like the stores: every role reads the
 * contractors, the Leitung and the Technische Leitung keep them, both on the
 * routes of the office.
 *
 * A firm that no longer works for the operator is marked (`deleted_at`) and
 * never removed: a duty, an activity and an evidence that named it go on
 * naming it. Nothing deletes a row, so the application role has no DELETE.
 * The rows travel to every device, to read the firm of an order; to one whose
 * person does not see the contractors with nothing but the name (#377).
 */
export const contractors = pgTable(
  'contractors',
  {
    id: primaryId<'contractor'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    phone: text('phone'),
    email: text('email'),
    services: text('services')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`)
      .$type<readonly string[]>(),
    note: text('note'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('contractors_tenant_id_key').on(table.tenantId, table.id),
    index('contractors_tenant_name_idx').on(table.tenantId, table.name),
    check('contractors_name_shaped', trimmed(table.name, contractorLimits.name)),
    check('contractors_street_shaped', optionalTrimmed(table.street, contractorLimits.street)),
    check(
      'contractors_postal_code_shaped',
      optionalTrimmed(table.postalCode, contractorLimits.postalCode),
    ),
    check('contractors_city_shaped', optionalTrimmed(table.city, contractorLimits.city)),
    check('contractors_phone_shaped', optionalTrimmed(table.phone, contractorLimits.phone)),
    check('contractors_email_shaped', optionalTrimmed(table.email, contractorLimits.email)),
    check('contractors_note_shaped', optionalTrimmed(table.note, contractorLimits.note)),
    // A service is a cost group of the list; the route keeps each once and in order.
    check(
      'contractors_services_of_the_list',
      sql`${table.services} <@ array[${sql.raw(contractorServices.map((service) => `'${service}'`).join(', '))}]::text[]`,
    ),
  ],
)
