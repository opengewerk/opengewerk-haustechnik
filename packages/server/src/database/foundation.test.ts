import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, foundationDeviations } from './test-database.js'

// The first migration of this application was put together from the building
// blocks of the foundation and is frozen since, like every migration. The
// blocks are not: a correction of the foundation changes them, and reaches a
// database of this application only through a migration of its own.
//
// This holds the two against each other, a database built from the blocks as
// they are today and this one after every migration. A deviation means the
// foundation has moved on and this application owes its database a migration
// that follows.

let admin: Pool

beforeAll(async () => {
  admin = await connect()
})

afterAll(async () => {
  await admin.end()
})

describe('the foundation in this database', () => {
  it('is what its building blocks say, after every migration', async () => {
    // What hangs of its own on tables of the foundation: the trigger that
    // gives a new membership its areas (ADR 0003, migration 0002), and what a
    // deadline hangs on (opengewerk-haustechnik#25, migration 0008), the duty
    // with its property and its area, their keys and index, and the policy
    // that keeps a deadline in the areas of the person who asks; and what a
    // contact hangs on (opengewerk-haustechnik#85, migration 0016), its
    // property with its area, the key and the index for it, the bounds of its
    // texts and the same policy. Only a restrictive policy may be named here;
    // it takes rows away and opens none.
    expect(
      await foundationDeviations(admin, {
        triggers: ['memberships.default_areas'],
        columns: [
          'deadlines.duty_id',
          'deadlines.property_id',
          'deadlines.area_id',
          'contacts.property_id',
          'contacts.area_id',
        ],
        constraints: [
          'deadlines.deadlines_follow_their_property',
          'deadlines.deadlines_of_a_duty_of_their_property',
          'contacts.contacts_follow_their_property',
          'contacts.contacts_given_name_shaped',
          'contacts.contacts_family_name_shaped',
          'contacts.contacts_role_shaped',
          'contacts.contacts_phone_shaped',
          'contacts.contacts_email_shaped',
        ],
        indexes: ['deadlines.deadlines_duty_idx', 'contacts.contacts_property_idx'],
        policies: ['deadlines.within_areas', 'contacts.within_areas'],
      }),
    ).toEqual([])
  })
})
