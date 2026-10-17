import type { InvitationId } from '@opengewerk/platform-domain'

import type { PropertyId } from './location.js'
import type { RoleKey } from './rights.js'

/**
 * What an access from outside is limited to beside its areas (#339, section
 * 4.3 of the concept): "Lesender Zugang für Prüfer von außen: befristet, auf
 * Liegenschaften oder Anlagenarten beschränkt". The database holds it on the
 * places, assets, duties, activities and documents (`within_limits`); here are
 * the rules a screen and a route share.
 *
 * An empty list is no limit in that dimension: an auditor limited to two
 * properties sees every kind of asset there, one limited to the emergency
 * lighting sees it in every property of the areas. With a limit to kinds of
 * assets, what hangs on no asset is outside it.
 */
export interface MemberLimits {
  readonly propertyIds: readonly PropertyId[]
  readonly assetKinds: readonly string[]
}

/** The limits of a membership, by the account. */
export interface MemberLimitsOf extends MemberLimits {
  readonly userId: string
}

/** The limits an open invitation names for the membership it becomes. */
export interface InvitationLimits extends MemberLimits {
  readonly invitationId: InvitationId
}

export const noLimits: MemberLimits = { propertyIds: [], assetKinds: [] }

/**
 * What the person asking is limited to, and up to which day, for the note an
 * auditor reads above the register (#339): the names of the properties, the
 * keys of the kinds, and the last day of the access, none for one without.
 */
export interface OwnLimits {
  /** Whether the person asking reads as an auditor from outside. */
  readonly auditor: boolean
  readonly lastDay: string | null
  readonly properties: readonly string[]
  readonly assetKinds: readonly string[]
}

/** The roles an access is limited for: the auditor alone. */
export const limitedRoles: readonly RoleKey[] = ['auditor']

/** The most properties and kinds of assets one access is limited to, each. */
export const limitsMaxLength = 200

export const limitWords = {
  title: 'Beschränkung',
  properties: 'Liegenschaften',
  assetKinds: 'Anlagenarten',
  everyProperty: 'Alle Liegenschaften seiner Bereiche',
  namedProperties: 'Genannte Liegenschaften',
  everyKind: 'Ohne Anlagenart sieht der Prüfer alle.',
  onlyAuditors: 'Auf Liegenschaften oder Anlagenarten beschränkt wird nur ein Zugang als Prüfer.',
  unknownKind: 'Diese Anlagenart gibt es nicht.',
  unknownProperty: 'Diese Liegenschaft gibt es nicht in den Bereichen des Zugangs.',
  tooMany: `Höchstens ${String(limitsMaxLength)} Liegenschaften und ebenso viele Anlagenarten.`,
} as const

/** Whether one of these roles is limited by what the access names. */
export function isLimited(roles: readonly string[]): boolean {
  return roles.some((role) => (limitedRoles as readonly string[]).includes(role))
}

/** Whether these limits name anything at all. */
export function limitsSomething(limits: MemberLimits): boolean {
  return limits.propertyIds.length > 0 || limits.assetKinds.length > 0
}

const kindKey = /^[a-z0-9_]+\.[a-z0-9_]+$/

/** What is wrong with these limits for an access with these roles, or null. */
export function limitsProblem(roles: readonly string[], limits: MemberLimits): string | null {
  if (limitsSomething(limits) && !isLimited(roles)) {
    return limitWords.onlyAuditors
  }

  if (limits.propertyIds.length > limitsMaxLength || limits.assetKinds.length > limitsMaxLength) {
    return limitWords.tooMany
  }

  if (!limits.assetKinds.every((kind) => kindKey.test(kind))) {
    return limitWords.unknownKind
  }

  return null
}

/**
 * The limits in words, for a list and the link of an invitation: the names of
 * the properties and of the kinds, or nothing where an access names none.
 */
export function limitsInWords(
  limits: MemberLimits,
  propertyName: (id: PropertyId) => string,
  kindLabel: (key: string) => string,
): string | null {
  const parts = [
    ...(limits.propertyIds.length === 0 ? [] : [limits.propertyIds.map(propertyName).join(', ')]),
    ...(limits.assetKinds.length === 0 ? [] : [limits.assetKinds.map(kindLabel).join(', ')]),
  ]

  return parts.length === 0 ? null : parts.join('; ')
}

/**
 * The note above the register of an auditor (#339, the board `pflichten` as
 * an auditor sees it): until when, where and which kinds, and that every
 * access is written down.
 */
export function ownLimitsInWords(own: OwnLimits, kindLabel: (key: string) => string): string {
  const until =
    own.lastDay === null
      ? ''
      : ` bis zum ${own.lastDay.slice(8, 10)}.${own.lastDay.slice(5, 7)}.${own.lastDay.slice(0, 4)}`
  const where =
    own.properties.length === 0 ? 'alle Liegenschaften Ihrer Bereiche' : own.properties.join(', ')
  const kinds =
    own.assetKinds.length === 0
      ? 'alle Anlagenarten'
      : `${own.assetKinds.length === 1 ? 'die Anlagenart' : 'die Anlagenarten'} ${listInWords(own.assetKinds.map(kindLabel))}`

  return `Sie lesen als Prüfer${until}: ${where}, ${kinds}. Jeder Zugriff wird festgehalten; die Leitung des Betreibers sieht ihn.`
}

function listInWords(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} und ${items.at(-1) ?? ''}`
}
