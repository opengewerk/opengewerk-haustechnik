import {
  type IsoDate,
  type PersonLevel,
  type QualificationCheck,
  qualificationCheck,
  type QualificationId,
  type QualificationStanding,
} from '@opengewerk/platform-domain'

import type { Catalogue } from './catalogue.js'

/**
 * The qualifications of the people who work for the operator in the office
 * (#337, section 4.3 of the concept), on the model of the foundation (ADR
 * 0012): the kinds of the packages, which the duty kinds ask for, and the
 * operator's own beside them; what each person holds; and the note that
 * whoever assigns an activity is given where the person lacks the kind its
 * duty asks for.
 */

/** The prefix an own kind takes where a choice names it beside those of the packages. */
export const ownKindPrefix = 'own:'

/** A kind as a choice offers it: of a package, or the operator's own. */
export interface QualificationKindChoice {
  /** `<package>.<key>` of a package, or `own:<id>` of the operator's own. */
  readonly key: string
  readonly label: string
  readonly level: PersonLevel
  /** The title of its package, or "Eigene Art". */
  readonly origin: string
  /** How many duty kinds ask for it; none for an own kind. */
  readonly requiredFor: number
  /** Whether nobody accepted the kind of a package yet. */
  readonly unaccepted: boolean
}

/** A qualification as the office lists it, with the person and the kind by name. */
export interface QualificationEntry {
  readonly id: QualificationId
  readonly userId: string
  readonly personName: string
  readonly kind: Pick<QualificationKindChoice, 'key' | 'label' | 'origin'>
  readonly validUntil: IsoDate | null
  readonly note: string | null
  readonly hasCertificate: boolean
  readonly standing: QualificationStanding
  readonly version: number
}

/** The list, with how many have run out and how many end within the lead. */
export interface QualificationList {
  readonly qualifications: readonly QualificationEntry[]
  readonly expired: number
  readonly expiring: number
  /** The days before its end from which a qualification ends soon: the lead of its deadline. */
  readonly leadDays: number
}

/**
 * What a person holds of the kind an activity asks for, as the choice of a
 * person names it to whoever may look at qualifications: nothing where the
 * person holds it, or where the activity asks for none.
 */
export interface QualificationHint {
  readonly kindLabel: string
  readonly check: Exclude<QualificationCheck, 'held'>
  /** The last day of the one that ran out, where it ran out. */
  readonly expiredOn: IsoDate | null
}

/** The kind an own key names, or null for a key of a package. */
export function ownKindIdOf(key: string): string | null {
  return key.startsWith(ownKindPrefix) ? key.slice(ownKindPrefix.length) : null
}

/** A kind an activity asks for, with every kind that does as well (#406). */
export interface RequiredKind {
  readonly key: string
  readonly label: string
  /** Its own key first, then the keys of the kinds that cover it. */
  readonly accepted: readonly string[]
}

/**
 * The kinds the duty kinds of an activity ask for, each once, by the key a
 * qualification keeps, with the kinds that cover each (#406). A duty of the
 * operator's own asks for none.
 */
export function requiredKinds(
  catalogue: Catalogue,
  dutyKindKeys: readonly (string | null)[],
): readonly RequiredKind[] {
  const found = new Map<string, RequiredKind>()

  for (const dutyKey of dutyKindKeys) {
    const kind = dutyKey === null ? null : catalogue.qualificationFor(dutyKey)

    if (kind !== null) {
      const { key, label } = kind.qualification

      found.set(key, {
        key,
        label,
        accepted: [key, ...catalogue.coveredBy(key).map((each) => each.qualification.key)],
      })
    }
  }

  return [...found.values()]
}

/** A qualification of a person as the check reads it. */
export type HeldQualification = Parameters<typeof qualificationCheck>[0][number]

/**
 * What a person holds of a kind an activity asks for (#337), on a day: held
 * where one of the accepted kinds is valid (#406), ran out where one of them
 * ran out and none is valid, with the last day of the one that ran out last,
 * and missing where the person holds none of them.
 */
export function heldOf(
  held: readonly HeldQualification[],
  kind: RequiredKind,
  day: IsoDate,
): { readonly check: QualificationCheck; readonly expiredOn: IsoDate | null } {
  const checks = kind.accepted.map((key) => qualificationCheck(held, key, day))
  const check: QualificationCheck = checks.includes('held')
    ? 'held'
    : checks.includes('expired')
      ? 'expired'
      : 'missing'
  const ranOut = held
    .filter(
      (row) =>
        row.deletedAt === null &&
        row.kindKey !== null &&
        kind.accepted.includes(row.kindKey) &&
        row.validUntil !== null,
    )
    .map((row) => row.validUntil as IsoDate)
    .sort()
    .at(-1)

  return { check, expiredOn: check === 'expired' ? (ranOut ?? null) : null }
}

/** The note in words: "Elektrofachkraft fehlt", "Elektrofachkraft abgelaufen am 15.09.2026". */
export function hintWords(hint: QualificationHint, date: (day: IsoDate) => string): string {
  return hint.check === 'missing'
    ? `${hint.kindLabel} fehlt`
    : `${hint.kindLabel} abgelaufen${hint.expiredOn === null ? '' : ` am ${date(hint.expiredOn)}`}`
}
