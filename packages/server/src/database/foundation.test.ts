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
    // texts and the same policy; and what a document hangs on
    // (opengewerk-haustechnik#97, migration 0019), its property with its
    // area, the record it names there and its kind, their keys, checks and
    // indexes, the same policy, and on its versions the policy that asks the
    // document, because a version carries no area. A deadline may follow a
    // defect instead of a duty, and a document may hang on a defect
    // (opengewerk-haustechnik#116, migration 0025); a deadline may follow the
    // plan of a round as well (opengewerk-haustechnik#113, migration 0030),
    // and the meters of a property (opengewerk-haustechnik#120, migration 0033),
    // with their keys, checks
    // and indexes; and a deadline names the task the engine made of it
    // (opengewerk-haustechnik#242, migration 0040), over its property. A duty points at the document that bears its interval and
    // at a version of it (opengewerk-haustechnik#74, migration 0037), over a
    // unique key on each. Since #306 the area of a deadline follows its
    // source and that of a document what it hangs on, by a key onto each,
    // and a document on the property itself names the property for its key a
    // second time, filled by a trigger (migration 0051); a contact is read by
    // whoever sees a building of its property. Only a restrictive policy may
    // be named here; it takes rows away and opens none. A version names the
    // day it is valid until, and a deadline may follow the document whose
    // newest version names one (opengewerk-haustechnik#327, migration 0056),
    // over a unique key on the document with its property.
    expect(
      await foundationDeviations(admin, {
        // A document takes nothing new at an activity emptied with its last
        // evidence after the end of the retention (opengewerk-haustechnik#409, migration 0073).
        triggers: [
          'memberships.default_areas',
          'attachments.area_from_the_property',
          'attachments.refuses_an_emptied_activity',
        ],
        columns: [
          'deadlines.duty_id',
          'deadlines.defect_id',
          'deadlines.round_plan_id',
          'deadlines.meter_property_id',
          'deadlines.task_id',
          'deadlines.property_id',
          'deadlines.area_id',
          'contacts.property_id',
          'contacts.area_id',
          'contacts.contractor_id',
          'attachments.property_id',
          'attachments.area_id',
          'attachments.building_id',
          'attachments.room_id',
          'attachments.asset_id',
          'attachments.activity_id',
          'attachments.defect_id',
          'attachments.kind',
          'attachments.legacy',
          'attachments.area_from_property_id',
          'attachments.contractor_id',
          'attachments.contract_id',
          'attachment_versions.valid_until',
          'deadlines.attachment_id',
          'deadlines.contract_id',
          'deadlines.warranty_asset_id',
          'deadlines.warranty_order_id',
          'deadlines.delegation_id',
          'deadlines.qualification_id',
          'deadlines.evidence_id',
          // The access whose end or removal a deadline follows (#356).
          'deadlines.member_user_id',
        ],
        constraints: [
          'deadlines.deadlines_meters_of_their_property',
          'deadlines.deadlines_follow_their_duty',
          'deadlines.deadlines_follow_their_defect',
          'deadlines.deadlines_follow_their_plan',
          'deadlines.deadlines_of_meters_follow_their_property',
          'deadlines.deadlines_of_a_duty_of_their_property',
          'deadlines.deadlines_of_a_defect_of_their_property',
          'deadlines.deadlines_of_a_plan_of_their_property',
          'deadlines.deadlines_with_a_task_of_their_property',
          'deadlines.deadlines_follow_one_source',
          'deadlines.deadlines_at_a_place_or_of_a_document',
          'deadlines.deadlines_follow_their_document',
          'deadlines.deadlines_of_a_document_of_their_property',
          'deadlines.deadlines_of_a_contract',
          'deadlines.deadlines_follow_their_asset',
          'deadlines.deadlines_of_an_asset_of_their_property',
          'deadlines.deadlines_follow_their_work_order',
          'deadlines.deadlines_of_a_work_order_of_their_property',
          'deadlines.deadlines_of_a_delegation',
          'deadlines.deadlines_of_a_qualification',
          'deadlines.deadlines_follow_their_evidence',
          'deadlines.deadlines_of_an_access',
          'attachments.attachments_area_key',
          'contacts.contacts_follow_their_property',
          'contacts.contacts_of_a_contractor',
          'contacts.contacts_at_a_property_or_a_contractor',
          'contacts.contacts_given_name_shaped',
          'contacts.contacts_family_name_shaped',
          'contacts.contacts_role_shaped',
          'contacts.contacts_phone_shaped',
          'contacts.contacts_mobile_shaped',
          'contacts.contacts_email_shaped',
          'attachments.attachments_follow_their_property',
          'attachments.attachments_follow_their_building',
          'attachments.attachments_follow_their_room',
          'attachments.attachments_follow_their_asset',
          'attachments.attachments_follow_their_activity',
          'attachments.attachments_follow_their_defect',
          'attachments.attachments_area_from_the_property',
          'attachments.attachments_at_a_building_of_their_property',
          'attachments.attachments_at_a_room_of_their_property',
          'attachments.attachments_at_an_asset_of_their_property',
          'attachments.attachments_at_an_activity_of_their_property',
          'attachments.attachments_at_a_defect_of_their_property',
          'attachments.attachments_hang_on_one_record',
          'attachments.attachments_at_their_activity',
          'attachments.attachments_title_shaped',
          'attachments.attachments_on_their_property',
          'attachments.attachments_of_a_contractor',
          'attachments.attachments_of_a_contract',
          'attachments.attachments_at_a_place_or_a_contractor',
          'attachment_versions.attachment_versions_of_their_document',
        ],
        indexes: [
          'deadlines.deadlines_duty_idx',
          'deadlines.deadlines_defect_idx',
          'deadlines.deadlines_round_plan_idx',
          'deadlines.deadlines_attachment_idx',
          'deadlines.deadlines_contract_idx',
          'deadlines.deadlines_warranty_asset_idx',
          'deadlines.deadlines_warranty_order_idx',
          'deadlines.deadlines_delegation_idx',
          'deadlines.deadlines_qualification_idx',
          'deadlines.deadlines_evidence_idx',
          'deadlines.deadlines_member_idx',
          'contacts.contacts_property_idx',
          'contacts.contacts_contractor_idx',
          'attachments.attachments_property_idx',
          'attachments.attachments_asset_idx',
          'attachments.attachments_activity_idx',
          'attachments.attachments_defect_idx',
          'attachments.attachments_contractor_idx',
          'attachments.attachments_contract_idx',
        ],
        policies: [
          'deadlines.within_areas',
          'contacts.within_areas_or_a_building',
          'contacts.within_areas_insert',
          'contacts.within_areas_update',
          'contacts.within_areas_delete',
          'attachments.within_areas',
          // The limits of an access from outside (#339), on every table with a property.
          'attachments.within_limits',
          'contacts.within_limits',
          'deadlines.within_limits',
          'attachment_versions.within_areas_of_their_file',
        ],
      }),
    ).toEqual([])
  })
})
