import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { canonicalForm } from './canonical.js'
import {
  delegationCovers,
  delegationInForce,
  delegationPageOf,
  delegationProblems,
  delegationState,
  delegationTermsOf,
  lastDayOf,
  nextResponsible,
  packageOfKind,
  revocationProblems,
} from './delegation.js'

const terms = {
  delegateUserId: 'u-joerg',
  areaIds: ['a-sued', 'a-nord', 'a-nord'],
  scope: 'all',
  packages: [],
  costGroups: [],
  tasks: '  Organisation der Prüfungen.  ',
  powers: 'Weisungsbefugnis im Bereich.',
  startsOn: '2026-11-01',
  endsOn: '2028-10-31',
}

describe('the terms of a delegation', () => {
  it('ask for a person, an area, a scope that says what it names, tasks, powers, a start and an end not before it', () => {
    expect(delegationProblems(terms)).toEqual({})
    expect(
      delegationProblems({
        delegateUserId: '',
        areaIds: [],
        scope: 'packages',
        packages: [],
        costGroups: ['44'],
        tasks: ' ',
        startsOn: '2026-11-01',
        endsOn: '2026-10-31',
      }),
    ).toEqual({
      delegateUserId: 'Wählen Sie die beauftragte Person.',
      areaIds: 'Wählen Sie mindestens einen Bereich.',
      packages: 'Wählen Sie mindestens ein Paket.',
      costGroups: 'Eine Kostengruppe ist eine Zahl der DIN 276 mit drei Ziffern, etwa 440.',
      tasks: 'Die Beschreibung der Aufgaben fehlt.',
      powers: 'Die Beschreibung der Befugnisse fehlt.',
      endsOn: 'Das Ende liegt vor dem Beginn.',
    })
    expect(delegationProblems({ ...terms, scope: 'all', packages: ['elektro'] })).toEqual({
      packages: 'Pakete nennt nur ein Umfang nach Paketen.',
    })
  })

  it('are written down trimmed and sorted, and signed as a page with the person and the keys of the areas', () => {
    const written = { ...delegationTermsOf(terms), delegateName: 'Jörg Albrecht' }

    expect(written.areaIds).toEqual(['a-nord', 'a-sued'])
    expect(written.tasks).toBe('Organisation der Prüfungen.')
    // The same terms in another order give the same page, and so the same fingerprint.
    expect(canonicalForm(delegationPageOf(written))).toBe(
      canonicalForm(delegationPageOf({ ...written, areaIds: ['a-sued', 'a-nord'] })),
    )
    expect(delegationPageOf(written)).toMatchObject({
      delegateUserId: 'u-joerg',
      delegateName: 'Jörg Albrecht',
      areaIds: ['a-nord', 'a-sued'],
    })
  })
})

describe('how a delegation stands', () => {
  const standing = {
    startsOn: '2026-11-01' as IsoDate,
    endsOn: '2028-10-31' as IsoDate,
    signedBy: [] as ('operator' | 'delegate')[],
    revokedTo: null as IsoDate | null,
  }
  const signed = { ...standing, signedBy: ['operator', 'delegate'] as ('operator' | 'delegate')[] }

  it('holds only once both have signed, from its start to its last day', () => {
    expect(delegationState(standing, '2026-12-01')).toBe('draft')
    expect(delegationState({ ...standing, signedBy: ['operator'] }, '2026-12-01')).toBe('waiting')
    expect(delegationInForce({ ...standing, signedBy: ['operator'] }, '2026-12-01')).toBe(false)
    expect(delegationState(signed, '2026-10-31')).toBe('upcoming')
    expect(delegationInForce(signed, '2026-10-31')).toBe(false)
    expect(delegationInForce(signed, '2026-11-01')).toBe(true)
    expect(delegationInForce(signed, '2028-10-31')).toBe(true)
    expect(delegationInForce(signed, '2028-11-01')).toBe(false)
    expect(delegationState(signed, '2028-11-01')).toBe('ended')
  })

  it('ends on the day a revocation brings forward, and says it was revoked', () => {
    const revoked = { ...signed, revokedTo: '2026-12-15' as IsoDate }

    expect(lastDayOf(revoked)).toBe('2026-12-15')
    expect(delegationInForce(revoked, '2026-12-15')).toBe(true)
    expect(delegationInForce(revoked, '2026-12-16')).toBe(false)
    expect(delegationState(revoked, '2026-12-01')).toBe('revoked')
  })

  it('is revoked from today on and before its end, with a reason', () => {
    expect(
      revocationProblems({ effectiveOn: '2026-12-15', reason: 'Wechsel.' }, signed, '2026-12-01'),
    ).toEqual({})
    expect(
      revocationProblems({ effectiveOn: '2026-11-30', reason: ' ' }, signed, '2026-12-01'),
    ).toEqual({
      effectiveOn: 'Ein Widerruf wirkt ab heute oder später.',
      reason: 'Der Grund fehlt.',
    })
    expect(
      revocationProblems({ effectiveOn: '2028-10-31', reason: 'Wechsel.' }, signed, '2026-12-01'),
    ).toEqual({
      effectiveOn: 'Ein Widerruf zieht das Ende vor: der Tag liegt vor dem bisherigen Ende.',
    })
  })
})

describe('the duties a delegation covers', () => {
  const inNorth = { areaId: 'a-nord', packageName: 'elektro', costGroup: '440' }

  it('lie in its areas, every one or those of its packages or cost groups', () => {
    const scope = { areaIds: ['a-nord'], packages: [], costGroups: [] }

    expect(delegationCovers({ ...scope, scope: 'all' }, inNorth)).toBe(true)
    expect(delegationCovers({ ...scope, scope: 'all' }, { ...inNorth, areaId: 'a-sued' })).toBe(
      false,
    )
    expect(delegationCovers({ ...scope, scope: 'packages', packages: ['elektro'] }, inNorth)).toBe(
      true,
    )
    expect(
      delegationCovers({ ...scope, scope: 'packages', packages: ['trinkwasser'] }, inNorth),
    ).toBe(false)
    expect(
      delegationCovers(
        { ...scope, scope: 'packages', packages: ['elektro'] },
        { ...inNorth, packageName: null },
      ),
    ).toBe(false)
    expect(delegationCovers({ ...scope, scope: 'cost_groups', costGroups: ['440'] }, inNorth)).toBe(
      true,
    )
    expect(delegationCovers({ ...scope, scope: 'cost_groups', costGroups: ['470'] }, inNorth)).toBe(
      false,
    )
    expect([packageOfKind('elektro.dguv_v3'), packageOfKind(null), packageOfKind('ohne')]).toEqual([
      'elektro',
      null,
      null,
    ])
  })
})

describe('who answers for a duty once the delegations are applied', () => {
  const joerg = { id: 'd-joerg', delegateUserId: 'u-joerg' }
  const petra = { id: 'd-petra', delegateUserId: 'u-petra' }

  it('is the person of the one delegation that covers it, also over somebody without one', () => {
    expect(nextResponsible({ userId: null, delegationId: null }, [joerg])).toEqual({
      userId: 'u-joerg',
      delegationId: 'd-joerg',
    })
    expect(nextResponsible({ userId: 'u-dennis', delegationId: null }, [joerg])).toEqual({
      userId: 'u-joerg',
      delegationId: 'd-joerg',
    })
  })

  it('is nobody once the delegation it came from no longer covers it', () => {
    expect(nextResponsible({ userId: 'u-joerg', delegationId: 'd-joerg' }, [])).toEqual({
      userId: null,
      delegationId: null,
    })
  })

  it('stays as it is where several cover it, unless it is one of them, and without any', () => {
    expect(nextResponsible({ userId: 'u-petra', delegationId: 'd-petra' }, [joerg, petra])).toEqual(
      {
        userId: 'u-petra',
        delegationId: 'd-petra',
      },
    )
    expect(nextResponsible({ userId: 'u-petra', delegationId: null }, [joerg, petra])).toEqual({
      userId: 'u-petra',
      delegationId: 'd-petra',
    })
    expect(nextResponsible({ userId: 'u-dennis', delegationId: null }, [joerg, petra])).toEqual({
      userId: 'u-dennis',
      delegationId: null,
    })
    expect(nextResponsible({ userId: 'u-dennis', delegationId: null }, [])).toEqual({
      userId: 'u-dennis',
      delegationId: null,
    })
  })
})
