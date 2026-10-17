import type { Id, IsoDate } from '@opengewerk/platform-domain'

import { calendarDay, type Problems, required } from './fields.js'

/**
 * The delegation of the operator's duties (section 4.3 of the concept, #336,
 * decided 15.10.2026), after § 13 Abs. 2 ArbSchG and § 13 DGUV Vorschrift 1:
 * in writing, with tasks, areas and powers, signed by both, with a start and
 * an end, as a document that is fixed once signed; the person it goes to
 * keeps a copy under "Konto". A delegation names its areas and its scope,
 * every duty there or certain packages or cost groups; every duty in that
 * scope has the person as the one who answers for it. Where two cover a
 * duty, the office chooses at the duty. The Leitung signs for the operator.
 * A person who answers for a duty without a delegation stays, and says
 * "ohne Übertragung", until one covers the duty. Revoking brings the end
 * forward, with a reason; the delegation stays readable.
 */

export type DutyDelegationId = Id<'duty-delegation'>

/** What a delegation covers in its areas: every duty, or those of certain packages or cost groups. */
export const delegationScopes = ['all', 'packages', 'cost_groups'] as const

export type DelegationScope = (typeof delegationScopes)[number]

export const delegationScopeLabel: Readonly<Record<DelegationScope, string>> = {
  all: 'Alle Pflichten',
  packages: 'Pakete',
  cost_groups: 'Kostengruppen',
}

/**
 * What a delegation covers, in words, as the list, its page and its PDF say
 * it: "Alle Pflichten", "Paket Elektro", "Kostengruppen 440, 470". A package
 * is named by its title where the catalogue is at hand.
 */
export function delegationScopeWords(
  entry: Pick<DelegationTerms, 'scope' | 'packages' | 'costGroups'>,
  titleOf: (packageName: string) => string = (packageName) => packageName,
): string {
  switch (entry.scope) {
    case 'all':
      return delegationScopeLabel.all
    case 'packages':
      return `${entry.packages.length === 1 ? 'Paket' : 'Pakete'} ${entry.packages.map(titleOf).join(', ')}`
    case 'cost_groups':
      return `${entry.costGroups.length === 1 ? 'Kostengruppe' : 'Kostengruppen'} ${entry.costGroups.join(', ')}`
  }
}

/** Who signs a delegation: the Leitung for the operator, and the person it goes to. */
export const delegationRoles = ['operator', 'delegate'] as const

export type DelegationRole = (typeof delegationRoles)[number]

export const delegationRoleLabel: Readonly<Record<DelegationRole, string>> = {
  operator: 'Für den Betreiber',
  delegate: 'Beauftragte Person',
}

/** The bounds of what a delegation carries, the same in the form, the route and the database. */
export const delegationLimits = {
  tasks: 4000,
  powers: 4000,
  reason: 1000,
  areas: 200,
  packages: 100,
  costGroups: 100,
} as const

/** A package as the catalogue names it, `elektro`, and a cost group of DIN 276, `440`. */
const packageShape = /^[a-z][a-z0-9_-]{0,63}$/
const costGroupShape = /^[1-9][0-9]{2}$/

/** What a delegation says, as the office writes it and both sign it. */
export interface DelegationTerms {
  readonly delegateUserId: string
  readonly areaIds: readonly string[]
  readonly scope: DelegationScope
  readonly packages: readonly string[]
  readonly costGroups: readonly string[]
  readonly tasks: string
  readonly powers: string
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

function listOf(value: unknown, shape: RegExp): readonly string[] | null {
  return Array.isArray(value) && value.every((each) => typeof each === 'string' && shape.test(each))
    ? (value as string[])
    : null
}

/**
 * What is wrong with the terms of a delegation, a sentence per field. All of
 * them are asked: a delegation is written whole, as it will be signed.
 */
export function delegationProblems(terms: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const delegate = terms['delegateUserId']

  if (typeof delegate !== 'string' || delegate.trim() === '') {
    problems['delegateUserId'] = 'Wählen Sie die beauftragte Person.'
  }

  const areas = terms['areaIds']

  if (
    !Array.isArray(areas) ||
    areas.length === 0 ||
    areas.length > delegationLimits.areas ||
    !areas.every((each) => typeof each === 'string' && each !== '')
  ) {
    problems['areaIds'] = 'Wählen Sie mindestens einen Bereich.'
  }

  const scope = terms['scope']

  if (!(delegationScopes as readonly unknown[]).includes(scope)) {
    problems['scope'] = 'Der Umfang ist alle Pflichten, Pakete oder Kostengruppen.'
  }

  const packages = listOf(terms['packages'] ?? [], packageShape)
  const costGroups = listOf(terms['costGroups'] ?? [], costGroupShape)

  if (packages === null || packages.length > delegationLimits.packages) {
    problems['packages'] = 'Ein Paket wird mit seinem Namen im Katalog genannt.'
  } else if (scope === 'packages' && packages.length === 0) {
    problems['packages'] = 'Wählen Sie mindestens ein Paket.'
  } else if (scope !== 'packages' && packages.length > 0) {
    problems['packages'] = 'Pakete nennt nur ein Umfang nach Paketen.'
  }

  if (costGroups === null || costGroups.length > delegationLimits.costGroups) {
    problems['costGroups'] =
      'Eine Kostengruppe ist eine Zahl der DIN 276 mit drei Ziffern, etwa 440.'
  } else if (scope === 'cost_groups' && costGroups.length === 0) {
    problems['costGroups'] = 'Wählen Sie mindestens eine Kostengruppe.'
  } else if (scope !== 'cost_groups' && costGroups.length > 0) {
    problems['costGroups'] = 'Kostengruppen nennt nur ein Umfang nach Kostengruppen.'
  }

  required(
    problems,
    { tasks: terms['tasks'] ?? null },
    'tasks',
    delegationLimits.tasks,
    'Die Beschreibung der Aufgaben',
  )
  required(
    problems,
    { powers: terms['powers'] ?? null },
    'powers',
    delegationLimits.powers,
    'Die Beschreibung der Befugnisse',
  )

  const startsOn = terms['startsOn']
  const endsOn = terms['endsOn']

  if (!calendarDay(startsOn)) {
    problems['startsOn'] = 'Der Beginn ist ein Tag, geschrieben 2026-10-03.'
  }

  if (!calendarDay(endsOn)) {
    problems['endsOn'] = 'Das Ende ist ein Tag, geschrieben 2026-10-03.'
  } else if (calendarDay(startsOn) && endsOn < startsOn) {
    problems['endsOn'] = 'Das Ende liegt vor dem Beginn.'
  }

  return problems
}

/** The terms as they are written down: texts trimmed, lists sorted and without twins. */
export function delegationTermsOf(terms: Readonly<Record<string, unknown>>): DelegationTerms {
  const sorted = (value: unknown) =>
    [...new Set(Array.isArray(value) ? (value as string[]) : [])].sort()

  return {
    delegateUserId: String(terms['delegateUserId']).trim(),
    areaIds: sorted(terms['areaIds']),
    scope: terms['scope'] as DelegationScope,
    packages: sorted(terms['packages']),
    costGroups: sorted(terms['costGroups']),
    tasks: String(terms['tasks']).trim(),
    powers: String(terms['powers']).trim(),
    startsOn: terms['startsOn'] as IsoDate,
    endsOn: terms['endsOn'] as IsoDate,
  }
}

/**
 * The page both sign (section 2.6 of the concept): the terms with nothing a
 * screen adds, lists in order, so that the office and the person read the
 * same text and the server works out the same fingerprint over it. The
 * person stands with the name the delegation was written with, which it
 * keeps; the areas by their keys, as their names may change.
 */
export interface DelegationPage {
  readonly version: 1
  readonly delegateUserId: string
  readonly delegateName: string
  readonly areaIds: readonly string[]
  readonly scope: DelegationScope
  readonly packages: readonly string[]
  readonly costGroups: readonly string[]
  readonly tasks: string
  readonly powers: string
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

export function delegationPageOf(
  terms: DelegationTerms & { readonly delegateName: string },
): DelegationPage {
  return {
    version: 1,
    delegateUserId: terms.delegateUserId,
    delegateName: terms.delegateName,
    areaIds: [...terms.areaIds].sort(),
    scope: terms.scope,
    packages: [...terms.packages].sort(),
    costGroups: [...terms.costGroups].sort(),
    tasks: terms.tasks,
    powers: terms.powers,
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
  }
}

/** How a delegation stands on a day. */
export const delegationStates = [
  'draft',
  'waiting',
  'upcoming',
  'in_force',
  'ended',
  'revoked',
] as const

export type DelegationState = (typeof delegationStates)[number]

export const delegationStateLabel: Readonly<Record<DelegationState, string>> = {
  draft: 'Entwurf',
  waiting: 'Wartet auf Unterschrift',
  upcoming: 'Unterschrieben, beginnt später',
  in_force: 'In Kraft',
  ended: 'Beendet',
  revoked: 'Widerrufen',
}

/** What the state of a delegation is worked out from. */
export interface DelegationStanding {
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
  readonly signedBy: readonly DelegationRole[]
  /** The day a revocation ends it on, if it was revoked. */
  readonly revokedTo: IsoDate | null
}

/** The last day a delegation holds: its end, or the day a revocation brought forward. */
export function lastDayOf(delegation: Pick<DelegationStanding, 'endsOn' | 'revokedTo'>): IsoDate {
  return delegation.revokedTo !== null && delegation.revokedTo < delegation.endsOn
    ? delegation.revokedTo
    : delegation.endsOn
}

/** Whether both have signed. */
export function signedByBoth(delegation: Pick<DelegationStanding, 'signedBy'>): boolean {
  return delegationRoles.every((role) => delegation.signedBy.includes(role))
}

/** Whether a delegation holds on a day: signed by both, begun, and not past its last day. */
export function delegationInForce(delegation: DelegationStanding, day: IsoDate): boolean {
  return signedByBoth(delegation) && delegation.startsOn <= day && day <= lastDayOf(delegation)
}

export function delegationState(delegation: DelegationStanding, day: IsoDate): DelegationState {
  if (delegation.signedBy.length === 0) {
    return 'draft'
  }

  if (!signedByBoth(delegation)) {
    return 'waiting'
  }

  if (delegation.revokedTo !== null) {
    return 'revoked'
  }

  if (day < delegation.startsOn) {
    return 'upcoming'
  }

  return day <= delegation.endsOn ? 'in_force' : 'ended'
}

/** What a duty is to a delegation: its area, the package of its kind, the cost group of its asset. */
export interface DutyInScope {
  readonly areaId: string
  /** The package its kind comes from, or null for a duty of the operator's own. */
  readonly packageName: string | null
  /** The cost group of the kind of its asset, or null where it hangs on no asset. */
  readonly costGroup: string | null
}

/** The package a duty kind comes from: the part of its key before the first point. */
export function packageOfKind(kind: string | null): string | null {
  if (kind === null) {
    return null
  }

  const point = kind.indexOf('.')

  return point <= 0 ? null : kind.slice(0, point)
}

/** Whether a delegation covers a duty: in one of its areas, and in its scope. */
export function delegationCovers(
  terms: Pick<DelegationTerms, 'areaIds' | 'scope' | 'packages' | 'costGroups'>,
  duty: DutyInScope,
): boolean {
  if (!terms.areaIds.includes(duty.areaId)) {
    return false
  }

  switch (terms.scope) {
    case 'all':
      return true
    case 'packages':
      return duty.packageName !== null && terms.packages.includes(duty.packageName)
    case 'cost_groups':
      return duty.costGroup !== null && terms.costGroups.includes(duty.costGroup)
  }
}

/** Who answers for a duty, and the delegation it comes from, if any. */
export interface Responsible {
  readonly userId: string | null
  readonly delegationId: string | null
}

/**
 * Who answers for a duty once the delegations that hold today are applied
 * to it (decided 15.10.2026):
 *
 * - one that came from a delegation that no longer covers it answers no
 *   more, and the duty has nobody, until another covers it;
 * - a single delegation that covers it gives it its person, also over
 *   somebody who answered without a delegation;
 * - where several cover it, it keeps one of them that it has; otherwise the
 *   office chooses at the duty, and until then it stays as it is;
 * - covered by none, it keeps whoever answers without a delegation.
 */
export function nextResponsible(
  current: Responsible,
  covering: readonly { readonly id: string; readonly delegateUserId: string }[],
): Responsible {
  const still =
    current.delegationId === null || covering.some((each) => each.id === current.delegationId)
      ? current
      : { userId: null, delegationId: null }
  const [only] = covering

  if (covering.length === 1 && only !== undefined) {
    return { userId: only.delegateUserId, delegationId: only.id }
  }

  if (covering.length > 1 && still.delegationId === null && still.userId !== null) {
    const theirs = covering.filter((each) => each.delegateUserId === still.userId)
    const [chosen] = theirs

    if (theirs.length === 1 && chosen !== undefined) {
      return { userId: chosen.delegateUserId, delegationId: chosen.id }
    }
  }

  return still
}

/** A signature under a delegation as a page shows it. */
export interface DelegationSignatureLine {
  readonly role: DelegationRole
  readonly name: string
  readonly signedAt: string
  readonly path: string | null
  readonly typedName: string | null
}

/** A delegation as the office lists it. */
export interface DelegationEntry {
  readonly id: DutyDelegationId
  readonly delegateUserId: string
  readonly delegateName: string
  readonly areas: readonly { readonly id: string; readonly name: string }[]
  readonly scope: DelegationScope
  readonly packages: readonly string[]
  readonly costGroups: readonly string[]
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
  /** The last day it holds, the end or the day a revocation brought forward. */
  readonly lastDay: IsoDate
  readonly state: DelegationState
}

/** A duty in the scope of a delegation, as its page lists it, with who answers for it today. */
export interface DelegationDutyLine {
  readonly dutyId: string
  readonly title: string
  readonly place: string
  readonly responsible: string | null
  /** Where who answers comes from: this delegation, another, none ("ohne Übertragung"), or nobody answers. */
  readonly from: 'this' | 'other' | 'none' | 'nobody'
}

/** The page of a delegation: what it says, who signed it when, how it was revoked, and the duties in its scope. */
export interface DelegationReading extends DelegationEntry {
  readonly tasks: string
  readonly powers: string
  readonly page: DelegationPage
  readonly signatures: readonly DelegationSignatureLine[]
  readonly revocation: {
    readonly effectiveOn: IsoDate
    readonly reason: string
    readonly name: string
    readonly at: string
  } | null
  readonly duties: { readonly total: number; readonly shown: readonly DelegationDutyLine[] }
  /** Whether the person asking may sign now, as whom. */
  readonly signs: DelegationRole | null
}

/** The bounds of a revocation and what is wrong with one. */
export function revocationProblems(
  revocation: Readonly<Record<string, unknown>>,
  delegation: Pick<DelegationStanding, 'endsOn'>,
  today: IsoDate,
): Readonly<Problems> {
  const problems: Problems = {}
  const effectiveOn = revocation['effectiveOn']

  if (!calendarDay(effectiveOn)) {
    problems['effectiveOn'] = 'Das Ende ist ein Tag, geschrieben 2026-10-03.'
  } else if (effectiveOn < today) {
    problems['effectiveOn'] = 'Ein Widerruf wirkt ab heute oder später.'
  } else if (effectiveOn >= delegation.endsOn) {
    problems['effectiveOn'] =
      'Ein Widerruf zieht das Ende vor: der Tag liegt vor dem bisherigen Ende.'
  }

  required(
    problems,
    { reason: revocation['reason'] ?? null },
    'reason',
    delegationLimits.reason,
    'Der Grund',
  )

  return problems
}
