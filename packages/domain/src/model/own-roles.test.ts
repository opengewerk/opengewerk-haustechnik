import { describe, expect, it } from 'vitest'

import {
  impliedBy,
  isShippedRole,
  leadingRights,
  newRightsOf,
  offerableRights,
  ownRoleProblems,
  ownRoleWords,
  rightGroups,
  withImplied,
} from './own-roles.js'
import { type Right, rights, shippedRoles } from './rights.js'

/** Roles a tenant makes for itself (#346, section 7 of the concept). */

describe('the rights a role of the tenant’s own may hold', () => {
  it('are every right of the catalogue but those that stay with the Leitung, the change log among them', () => {
    expect(offerableRights).toEqual(
      rights.filter((right) => !(leadingRights as readonly Right[]).includes(right)),
    )
    expect(offerableRights).not.toContain('audit.read')
    expect(offerableRights).not.toContain('membership.write')
    expect(leadingRights.every((right) => shippedRoles[0]?.rights.includes(right))).toBe(true)
  })

  it('stand on a screen in groups that hold each of them once, and none of the Leitung', () => {
    const grouped = rightGroups.flatMap((group) => group.rights)

    expect([...grouped].sort()).toEqual([...offerableRights].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('bring what comes with them: whoever changes sees, and whoever sees the deadlines sees the contracts', () => {
    expect(withImplied(['asset.write'])).toEqual(['asset.read', 'asset.write'])
    expect(withImplied(['deadline.write'])).toEqual([
      'deadline.read',
      'deadline.write',
      'contract.read',
    ])
    expect(withImplied(['sync.write', 'store.write'])).toEqual([
      'store.read',
      'store.write',
      'sync.read',
      'sync.write',
    ])
    expect(withImplied(['location.read'])).toEqual(['location.read'])
    expect(impliedBy('asset.read', ['asset.read', 'asset.write'])).toBe('asset.write')
    expect(impliedBy('asset.write', ['asset.read', 'asset.write'])).toBeNull()
  })

  it('come from what a shipped role holds, whose rights are closed under what comes with them, the Leitung aside', () => {
    for (const role of shippedRoles.filter((each) => !each.leads)) {
      expect([role.key, withImplied(role.rights)]).toEqual([role.key, role.rights])
    }
  })
})

describe('a role of the tenant’s own', () => {
  it('has a label, rights from the catalogue, at least one, and none of the Leitung', () => {
    expect(
      ownRoleProblems({ label: 'Hausmeisterei', rights: ['asset.read'], secondFactor: true }),
    ).toEqual({})
    expect(ownRoleProblems({ label: '  ' })).toEqual({ label: 'Die Bezeichnung fehlt.' })
    expect(ownRoleProblems({ label: 'x'.repeat(81) })).toEqual({
      label: 'Die Bezeichnung hat höchstens 80 Zeichen.',
    })
    expect(ownRoleProblems({ rights: ['asset.read', 'audit.read'] })).toEqual({
      rights: '„Das Änderungsprotokoll einsehen“ bleibt der Leitung.',
    })
    expect(ownRoleProblems({ rights: ['membership.read', 'membership.write'] })).toEqual({
      rights: '„Zugänge ansehen“, „Zugänge verwalten“ bleiben der Leitung.',
    })
    expect(ownRoleProblems({ rights: ['asset.read', 'asset.fly'] })).toEqual({
      rights: 'Die Rechte sind Rechte aus dem Katalog dieser Anwendung.',
    })
    expect(ownRoleProblems({ rights: [] })).toEqual({
      rights: 'Eine Rolle ohne ein Recht kann nichts. Mindestens eines wählen.',
    })
    expect(ownRoleProblems({ secondFactor: 'ja' })).toEqual({
      secondFactor: 'Ob die Rolle einen zweiten Faktor verlangt, ist ja oder nein.',
    })
  })

  it('is told the rights a later version brought that it does not hold, and a shipped role is not', () => {
    const offered = offerableRights.filter((right) => right !== 'contractor.read')

    expect(
      newRightsOf({ key: 'own-caretaker', rights: ['asset.read'], offeredRights: offered }),
    ).toEqual(['contractor.read'])
    expect(
      newRightsOf({
        key: 'own-caretaker',
        rights: ['asset.read', 'contractor.read'],
        offeredRights: offered,
      }),
    ).toEqual([])
    expect(newRightsOf({ key: 'technician', rights: [], offeredRights: [] })).toEqual([])
    expect(isShippedRole('technician')).toBe(true)
    expect(isShippedRole('own-caretaker')).toBe(false)
  })

  it('names what keeps it from going', () => {
    expect(ownRoleWords.inUse(2, 0)).toBe(
      'Die Rolle ist noch 2 Zugängen zugeordnet. Erst eine andere Rolle geben, dann entfernen.',
    )
    expect(ownRoleWords.inUse(1, 1)).toBe(
      'Die Rolle ist noch 1 Zugang und 1 offenen Einladung zugeordnet. Erst eine andere Rolle geben, dann entfernen.',
    )
  })
})
