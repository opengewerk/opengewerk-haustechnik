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
      duty: ['read', 'write', 'delegate'],
      qualification: ['read', 'write'],
      deadline: ['read', 'write'],
      template: ['write'],
      activity: ['read', 'perform', 'write', 'accept'],
      evidence: ['read', 'write'],
      defect: ['read', 'report', 'write'],
      fault: ['report', 'accept'],
      document: ['read', 'record', 'remove'],
      task: ['read', 'record', 'assign'],
      store: ['read', 'write'],
      contractor: ['read', 'write'],
      contract: ['read', 'write'],
      report: ['read'],
      sync: ['read', 'write'],
      push: ['write'],
      membership: ['read', 'write'],
      settings: ['read', 'write'],
      mail: ['read', 'write'],
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
  it('are the four of phase 1 and the Melder and the Prüfer of phase 2, in the order a screen lists them', () => {
    expect(shippedRoles.map((role) => role.key)).toEqual([...roleKeys])
    expect(shippedRoles.map((role) => role.label)).toEqual([
      'Leitung',
      'Technische Leitung',
      'Objektleitung',
      'Haustechnik',
      'Melder',
      'Prüfer',
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

  it('each hold what the role after them holds, the four of phase 1, and the Haustechnik what the Melder and the Prüfer hold', () => {
    // The Melder and the Prüfer stand beside each other, neither holds the other's (#339).
    const phaseOne = shippedRoles.slice(0, 4)
    const technician = shippedRoles.find((role) => role.key === 'technician')

    for (const outside of shippedRoles.slice(4)) {
      expect([
        outside.key,
        outside.rights.filter((right) => !technician?.rights.includes(right)),
      ]).toEqual([outside.key, []])
    }

    for (const [position, role] of phaseOne.entries()) {
      const below = phaseOne[position + 1]

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
      'contract.read',
      'contract.write',
      'contractor.read',
      'contractor.write',
      'deadline.read',
      'deadline.write',
      'defect.read',
      'defect.report',
      'defect.write',
      'document.read',
      'document.record',
      'document.remove',
      'duty.read',
      'duty.write',
      'evidence.read',
      'evidence.write',
      'fault.accept',
      'fault.report',
      'location.read',
      'location.write',
      'push.write',
      'qualification.read',
      'qualification.write',
      'reading.write',
      'report.read',
      'room.record',
      'store.read',
      'store.write',
      'sync.read',
      'sync.write',
      'task.assign',
      'task.read',
      'task.record',
      'template.write',
    ])
  })

  it('may not say who works for the tenant, set anything for it or read its change log', () => {
    expect(mayNot('technical_management')).toEqual([
      'audit.read',
      'duty.delegate',
      'mail.read',
      'mail.write',
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
      'contract.read',
      'contractor.read',
      'defect.read',
      'defect.report',
      'defect.write',
      'document.read',
      'document.record',
      'document.remove',
      'duty.read',
      'evidence.read',
      'evidence.write',
      'fault.accept',
      'fault.report',
      'location.read',
      'push.write',
      'qualification.read',
      'reading.write',
      'room.record',
      'store.read',
      'store.write',
      'sync.read',
      'sync.write',
      'task.assign',
      'task.read',
      'task.record',
      'template.write',
    ])
  })

  it('may not change the structure of the properties, the register of duties or the deadlines', () => {
    expect(mayNot('site_management')).toEqual([
      'audit.read',
      'contract.write',
      'contractor.write',
      'deadline.read',
      'deadline.write',
      'duty.delegate',
      'duty.write',
      'location.write',
      'mail.read',
      'mail.write',
      'membership.read',
      'membership.write',
      'qualification.write',
      'report.read',
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
      'contractor.read',
      'defect.read',
      'defect.report',
      'document.read',
      'document.record',
      'duty.read',
      'evidence.read',
      'fault.report',
      'location.read',
      'push.write',
      'reading.write',
      'room.record',
      'store.read',
      'sync.read',
      'sync.write',
      'task.read',
      'task.record',
    ])
  })

  it('may not plan or sign off, take an asset out of service, enter evidence or decide about a defect', () => {
    expect(mayNot('technician')).toEqual([
      'activity.accept',
      'activity.write',
      'asset.write',
      'audit.read',
      'contract.read',
      'contract.write',
      'contractor.write',
      'deadline.read',
      'deadline.write',
      'defect.write',
      'document.remove',
      'duty.delegate',
      'duty.write',
      'evidence.write',
      'fault.accept',
      'location.write',
      'mail.read',
      'mail.write',
      'membership.read',
      'membership.write',
      'qualification.read',
      'qualification.write',
      'report.read',
      'settings.read',
      'settings.write',
      'store.write',
      'task.assign',
      'template.write',
    ])
  })
})

describe('"Melder"', () => {
  it('may report a fault, see its own reports, switch push on for the feedback and take part in the exchange, and nothing else', () => {
    expect(may('reporter')).toEqual(['fault.report', 'push.write', 'sync.read', 'sync.write'])
  })

  it('sees no place, so that its device holds nothing of the operator', () => {
    expect(mayNot('reporter')).toEqual(
      expect.arrayContaining(['location.read', 'asset.read', 'activity.read', 'defect.read']),
    )
  })

  it('does not lead the tenant and is not asked for a second factor', () => {
    expect(roleOf('reporter').leads).toBe(false)
    expect(roleOf('reporter').secondFactor).toBe(false)
  })
})

describe('"Prüfer"', () => {
  it('reads the duties and their evidence and takes what they hang on, and nothing else: no place, no writing, no push (#339)', () => {
    expect(may('auditor')).toEqual(['duty.read', 'evidence.read', 'sync.read'])
  })

  it('does not lead the tenant and is not asked for a second factor', () => {
    expect(roleOf('auditor').leads).toBe(false)
    expect(roleOf('auditor').secondFactor).toBe(false)
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
