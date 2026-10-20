import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { activityProblems, workOrderNoteProblems, workOrderPlanProblems } from './activity.js'
import { assetProblems } from './asset.js'
import { collectivePlanProblems } from './collective.js'
import { contractProblems } from './contract.js'
import { contractorProblems } from './contractor.js'
import { defectProblems } from './defect.js'
import { delegationProblems, revocationProblems } from './delegation.js'
import { documentProblems } from './document.js'
import { dismissalProblems } from './duty-record.js'
import { keepingProblems } from './duty-update.js'
import {
  faultCategoryProblems,
  faultRejectionProblems,
  faultReportProblems,
  outsideReportProblems,
} from './fault-report.js'
import { type Problems, required } from './fields.js'
import { buildingProblems, floorProblems, propertyProblems } from './location.js'
import { meterExchangeProblems, meterPauseProblems } from './meter-reading.js'
import { ownFieldProblems, ownKindProblems } from './own-kinds.js'

type Check = (record: Readonly<Record<string, unknown>>) => Readonly<Problems>

/** What `required` finds in a record about its field `name`. */
function asked(record: Readonly<Record<string, unknown>>): Problems {
  const problems: Problems = {}

  required(problems, record, 'name', 10, 'Der Name')

  return problems
}

describe('a text a record has to have', () => {
  it('is not asked about where it is not given, as in a change of other fields', () => {
    expect(asked({})).toEqual({})
    expect(asked({ name: undefined })).toEqual({})
  })

  it('is missing where it is emptied, and has a most length', () => {
    for (const name of [null, '', '   ', 5]) {
      expect(asked({ name })).toEqual({ name: 'Der Name fehlt.' })
    }

    expect(asked({ name: ' Anlage ' })).toEqual({})
    expect(asked({ name: 'x'.repeat(11) })).toEqual({ name: 'Der Name hat höchstens 10 Zeichen.' })
  })
})

describe('the checks that ask a text a record has to have (#472)', () => {
  // A change names only the fields it changes, and the route of a new record
  // hands in null for each such field it was not given.
  const onlyWhatIsGiven: readonly (readonly [string, string, Check])[] = [
    ['an activity', 'title', activityProblems],
    ['a note of a work order', 'text', workOrderNoteProblems],
    ['an asset', 'kind', assetProblems],
    ['an asset', 'name', assetProblems],
    ['a contract', 'title', contractProblems],
    ['a contractor', 'name', contractorProblems],
    ['a defect', 'description', (record) => defectProblems(record)],
    ['a document', 'title', documentProblems],
    ['a property', 'name', propertyProblems],
    ['a property', 'street', propertyProblems],
    ['a property', 'city', propertyProblems],
    ['a building', 'name', buildingProblems],
    ['a floor', 'name', floorProblems],
    ['an exchange of a meter', 'newNumber', meterExchangeProblems],
    ['a pause of a meter', 'reason', meterPauseProblems],
    ['an own kind', 'label', (record) => ownKindProblems(record, [])],
    ['an own field', 'label', ownFieldProblems],
  ]

  it.each(onlyWhatIsGiven)(
    'of %s leave out the field %s where it is not given, and find it missing as null',
    (_, field, check) => {
      expect(check({})[field]).toBeUndefined()
      expect(check({ [field]: null })[field]).toMatch(/ fehlt\.$/u)
    },
  )

  // Asked only of something new, so a field that was not given is missing.
  const ofSomethingNew: readonly (readonly [string, string, Check])[] = [
    ['a fault report', 'description', faultReportProblems],
    ['a report without an account', 'description', outsideReportProblems],
    ['a rejection of a fault report', 'reason', faultRejectionProblems],
    ['a category of faults', 'name', faultCategoryProblems],
    ['a plan of work orders', 'title', workOrderPlanProblems],
    ['a plan of a collective', 'title', collectivePlanProblems],
    ['a delegation', 'tasks', delegationProblems],
    ['a delegation', 'powers', delegationProblems],
    [
      'a revocation',
      'reason',
      (record) =>
        revocationProblems(record, { endsOn: '2027-12-31' as IsoDate }, '2026-10-20' as IsoDate),
    ],
    ['a dismissal', 'reason', dismissalProblems],
    ['a keeping', 'reason', keepingProblems],
  ]

  it.each(ofSomethingNew)(
    'of %s find the field %s missing where it is not given',
    (_, field, check) => {
      expect(check({})[field]).toMatch(/ fehlt\.$/u)
    },
  )
})
