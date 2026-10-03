import { accessRights } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  applicationRights,
  isAllowed,
  missingRight,
  type Right,
  rightLabel,
  rights,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  shippedRoles,
} from './rights.js'

/** What a role may do, sorted, to be held against a list written out here. */
function may(key: RoleKey): Right[] {
  return [...rightsOfRoles([key])].sort()
}

/** What a role may not do: the rest of the catalogue. */
function mayNot(key: RoleKey): Right[] {
  const held = rightsOfRoles([key])

  return rights.filter((right) => !held.has(right)).sort()
}

function roleOf(key: RoleKey) {
  const role = shippedRoles.find((candidate) => candidate.key === key)

  if (!role) {
    throw new Error(`No shipped role is called ${key}.`)
  }

  return role
}

describe('the catalogue of rights', () => {
  /**
   * The whole catalogue, held here a second time on purpose. A right that is
   * added, removed or renamed turns this red, which makes it a decision and
   * not a line in a diff: the same change is owed to section 7 of the
   * concept, and for a role a tenant already has, to its rows.
   *
   * What is not in it matters as much as what is. Evidence can be read and
   * entered and nothing else: there is no right that changes or removes it.
   * No right stands in for a signature, and none lets a work order pass
   * without being accepted. Those are promises the application cannot switch
   * off (section 7), so there is nothing here a role could be given to lift
   * one.
   */
  it('is these things with these verbs and no others', () => {
    const verbs = new Map<string, string[]>()

    for (const right of rights) {
      const [thing = '', verb = ''] = right.split('.')

      verbs.set(thing, [...(verbs.get(thing) ?? []), verb])
    }

    expect(Object.fromEntries(verbs)).toEqual({
      location: ['read', 'write'],
      room: ['record'],
      asset: ['read', 'record', 'write'],
      reading: ['write'],
      duty: ['read', 'write'],
      deadline: ['read', 'write'],
      activity: ['read', 'perform', 'write', 'accept'],
      evidence: ['read', 'write'],
      defect: ['read', 'report', 'write'],
      sync: ['read', 'write'],
      membership: ['read', 'write'],
      settings: ['read', 'write'],
      audit: ['read'],
    })
  })

  it('names every right as a thing and what is done to it', () => {
    expect(rights.filter((right) => !/^[a-z]+\.[a-z]+$/.test(right))).toEqual([])
  })

  it('has words for every right, and no two rights share them', () => {
    const labels = rights.map((right) => rightLabel[right])

    expect(labels.filter((label) => label.trim() === '')).toEqual([])
    expect(new Set(labels).size).toBe(rights.length)
    // A label is the join between this list and the table in the concept, so
    // a key of the table that is no right would go unnoticed here.
    expect(Object.keys(rightLabel).sort()).toEqual([...rights].sort())
  })

  it('says in a refusal what the access may not do and who can change that', () => {
    expect(missingRight('asset.write')).toBe(
      'Anlagen pflegen darf dieser Zugang nicht. Die Leitung vergibt die Rollen unter „Zugänge“.',
    )
  })
})

describe('the roles a tenant starts with', () => {
  it('are the four of phase 1, in the order a screen lists them', () => {
    expect(shippedRoles.map((role) => role.key)).toEqual([...roleKeys])
    expect(shippedRoles.map((role) => role.label)).toEqual([
      'Leitung',
      'Technische Leitung',
      'Objektleitung',
      'Haustechnik',
    ])
  })

  it('hold only rights of the catalogue, each once and in its order', () => {
    for (const role of shippedRoles) {
      expect([role.key, role.rights]).toEqual([
        role.key,
        rights.filter((right) => role.rights.includes(right)),
      ])
    }
  })

  it('each hold what the role after them holds', () => {
    for (const [position, role] of shippedRoles.entries()) {
      const below = shippedRoles[position + 1]

      if (!below) {
        continue
      }

      expect([role.key, below.rights.filter((right) => !role.rights.includes(right))]).toEqual([
        role.key,
        [],
      ])
    }
  })

  /**
   * Leading and the second factor are flags of the role. As rights they could
   * be taken away with the right, by a tenant editing a role, and the two
   * things that must not be possible to switch off would hang on a checkbox.
   */
  it('have exactly one that leads, and it is the one that needs a second factor', () => {
    expect(shippedRoles.filter((role) => role.leads).map((role) => role.key)).toEqual([
      'management',
    ])
    expect(shippedRoles.filter((role) => role.secondFactor).map((role) => role.key)).toEqual([
      'management',
    ])
  })

  it('give the administration of who works for a tenant to the role that leads and to no other', () => {
    for (const role of shippedRoles) {
      const administers = role.rights.filter(
        (right) => right === accessRights.read || right === accessRights.write,
      )

      expect([role.key, administers]).toEqual([
        role.key,
        role.leads ? [accessRights.read, accessRights.write] : [],
      ])
    }
  })
})

describe('"Leitung"', () => {
  it('may do everything in the tenant', () => {
    expect(may('management')).toEqual([...rights].sort())
    expect(mayNot('management')).toEqual([])
  })

  it('leads the tenant and works only with a second factor', () => {
    expect(roleOf('management').leads).toBe(true)
    expect(roleOf('management').secondFactor).toBe(true)
    expect(applicationRights.sumOf([roleOf('management')]).secondFactor).toBe(true)
  })
})

describe('"Technische Leitung"', () => {
  it('may do everything about places, assets, duties and the work on them', () => {
    expect(may('technical_management')).toEqual([
      'activity.accept',
      'activity.perform',
      'activity.read',
      'activity.write',
      'asset.read',
      'asset.record',
      'asset.write',
      'deadline.read',
      'deadline.write',
      'defect.read',
      'defect.report',
      'defect.write',
      'duty.read',
      'duty.write',
      'evidence.read',
      'evidence.write',
      'location.read',
      'location.write',
      'reading.write',
      'room.record',
      'sync.read',
      'sync.write',
    ])
  })

  it('may not say who works for the tenant, set anything for it or read its change log', () => {
    expect(mayNot('technical_management')).toEqual([
      'audit.read',
      'membership.read',
      'membership.write',
      'settings.read',
      'settings.write',
    ])
  })

  it('does not lead the tenant and is not asked for a second factor', () => {
    const sum = applicationRights.sumOf([roleOf('technical_management')])

    expect(sum.leads).toBe(false)
    expect(sum.secondFactor).toBe(false)
  })
})

describe('"Objektleitung"', () => {
  it('may plan, hand out and sign off the work and take care of the assets', () => {
    expect(may('site_management')).toEqual([
      'activity.accept',
      'activity.perform',
      'activity.read',
      'activity.write',
      'asset.read',
      'asset.record',
      'asset.write',
      'defect.read',
      'defect.report',
      'defect.write',
      'duty.read',
      'evidence.read',
      'evidence.write',
      'location.read',
      'reading.write',
      'room.record',
      'sync.read',
      'sync.write',
    ])
  })

  it('may not change the structure of the properties, the register of duties or the deadlines', () => {
    expect(mayNot('site_management')).toEqual([
      'audit.read',
      'deadline.read',
      'deadline.write',
      'duty.write',
      'location.write',
      'membership.read',
      'membership.write',
      'settings.read',
      'settings.write',
    ])
  })
})

describe('"Haustechnik"', () => {
  it('may look, take stock, do the work, read meters and report a defect', () => {
    expect(may('technician')).toEqual([
      'activity.perform',
      'activity.read',
      'asset.read',
      'asset.record',
      'defect.read',
      'defect.report',
      'duty.read',
      'evidence.read',
      'location.read',
      'reading.write',
      'room.record',
      'sync.read',
      'sync.write',
    ])
  })

  it('may not plan or sign off, take an asset out of service, enter evidence or decide about a defect', () => {
    expect(mayNot('technician')).toEqual([
      'activity.accept',
      'activity.write',
      'asset.write',
      'audit.read',
      'deadline.read',
      'deadline.write',
      'defect.write',
      'duty.write',
      'evidence.write',
      'location.write',
      'membership.read',
      'membership.write',
      'settings.read',
      'settings.write',
    ])
  })
})

describe('what somebody may do', () => {
  it('is what their roles add up to', () => {
    expect([...rightsOfRoles(['technician', 'site_management'])].sort()).toEqual(
      may('site_management'),
    )
    expect(rightsOfRoles([]).size).toBe(0)
  })

  it('is asked of the rights an identity carries and of nothing else', () => {
    expect(isAllowed({ rights: ['asset.record'] }, 'asset.record')).toBe(true)
    expect(isAllowed({ rights: ['asset.record'] }, 'asset.write')).toBe(false)
    expect(isAllowed({ rights: [] }, 'location.read')).toBe(false)
  })

  /**
   * A row can come to hold a right this version does not know: one of a newer
   * version after a step back, or a typo somebody made at a prompt. It gives
   * nothing, because guessing what it meant would hand out something nobody
   * decided on.
   */
  it('does not grow by a right the catalogue does not know', () => {
    const sum = applicationRights.sumOf([
      { rights: ['asset.read', 'evidence.delete'], leads: false, secondFactor: false },
    ])

    expect(sum.rights).toEqual(['asset.read'])
  })
})
