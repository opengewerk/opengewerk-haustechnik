import { addDays, type Id, type IsoDate, type TenantOwned } from '@opengewerk/platform-domain'

/**
 * The end of an access (sections 2.4 and 9 of the concept, #356, decided
 * 15.10.2026): the last day stands on the membership, and after it the access
 * ends by itself. On the last day what is assigned to the person goes back to
 * planning and the duties they answer for stand without a person; after a
 * period the operator sets, the devices, the passkeys and, where the account
 * works nowhere else, its address go. The name stays, because what the person
 * signed names them.
 */

export type MembershipSettingId = Id<'membership-setting'>
export type MembershipRemovalId = Id<'membership-removal'>

/** The row an operator's period is kept in, one per operator that set one. */
export interface MembershipSetting extends TenantOwned {
  readonly id: MembershipSettingId
  readonly removalDays: number
}

/** When the data of an access went, once per access, and whether the account went with it. */
export interface MembershipRemoval extends TenantOwned {
  readonly id: MembershipRemovalId
  readonly userId: string
  readonly removedAt: Date
  readonly accountRemoved: boolean
}

/** How many days after the last day the data goes: the standard without a setting, and what a setting may name. */
export const membershipRemovalDays = { standard: 90, minimum: 1, maximum: 3650 } as const

/** The period of an operator as a route hands it out, and whether it is the standard. */
export interface MembershipSettings {
  readonly removalDays: number
  readonly standard: boolean
}

/** What is wrong with a period, as the screen says it, or nothing. */
export function removalDaysProblem(value: unknown): string | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= membershipRemovalDays.minimum &&
    value <= membershipRemovalDays.maximum
    ? null
    : `Die Frist ist eine ganze Zahl von Tagen, mindestens ${String(membershipRemovalDays.minimum)} und höchstens ${String(membershipRemovalDays.maximum)}.`
}

/** The day the data of an access goes: the period, counted from the day after its last day. */
export function removalDay(lastDay: IsoDate, removalDays: number): IsoDate {
  return addDays(lastDay, removalDays)
}

/**
 * What still hangs on a person in this operator (#356), shown before the last
 * day: open activities assigned to them or that they answer for, the started
 * among them, plans of rounds they perform, open tasks, duties they answer
 * for and delegations of duties to them that are signed and running. Numbers
 * only: whoever sets the last day sees how much, the lists say what.
 */
export interface AssignedToPerson {
  readonly activities: number
  readonly startedActivities: number
  readonly roundPlans: number
  readonly tasks: number
  readonly duties: number
  readonly delegations: number
}

/** The words of the end of an access. */
export const membershipEndWords = {
  settingTitle: 'Nach dem Ende eines Zugangs',
  settingText:
    'Nach dem letzten Tag eines Zugangs meldet sich die Person nicht mehr an, und ihre Geräte gleichen nicht mehr ab. Nach dieser Frist werden ihre Geräte, Passkeys und die E-Mail entfernt, wenn das Konto keinem anderen Betreiber dieser Instanz angehört. Der Name bleibt, denn die Nachweise nennen, wer unterschrieben hat.',
  removalDaysLabel: 'Angaben entfernen nach',
  removalDaysUnit: 'Tagen',
  removalDaysHint:
    'Gezählt ab dem Tag nach dem letzten Tag. Beides steht unter „Fristen“ und läuft von selbst.',
  saved: 'Gespeichert.',
  hangingOf: (name: string) => `Was noch an ${name} hängt`,
  nothingHanging: 'Nichts: keine offenen Vorgänge, Pläne, Aufgaben, Pflichten oder Übertragungen.',
  activities: (count: number, started: number) =>
    `${String(count)} ${count === 1 ? 'Vorgang' : 'Vorgänge'}, zugeteilt oder verantwortet${started > 0 ? `, ${String(started)} davon begonnen` : ''}`,
  activitiesThen: (count: number) =>
    `${count === 1 ? 'geht' : 'gehen'} am Tag nach dem letzten Tag an die Planung zurück`,
  roundPlans: (count: number) =>
    `${String(count)} ${count === 1 ? 'Plan eines Rundgangs, den' : 'Pläne von Rundgängen, die'} sie oder er ausführt`,
  roundPlansThen: (count: number) =>
    `${count === 1 ? 'geht' : 'gehen'} am Tag nach dem letzten Tag an die Planung zurück`,
  tasks: (count: number) => `${String(count)} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}`,
  tasksThen: (count: number) =>
    `${count === 1 ? 'geht' : 'gehen'} am Tag nach dem letzten Tag an die Person, die sie angelegt hat, sonst an die Leitung`,
  duties: (count: number) =>
    `${String(count)} ${count === 1 ? 'Pflicht' : 'Pflichten'}, für die sie oder er verantwortlich ist`,
  dutiesThen: (count: number) => `${count === 1 ? 'steht' : 'stehen'} danach ohne Verantwortlichen`,
  delegations: (count: number) =>
    `${String(count)} ${count === 1 ? 'Pflichtenübertragung' : 'Pflichtenübertragungen'} an sie oder ihn`,
  delegationsThen: (count: number) =>
    `${count === 1 ? 'zählt' : 'zählen'} danach nicht mehr; ihre Pflichten stehen ohne Verantwortlichen`,
  after:
    'Unterschriebenes bleibt, wie es ist. Nach der Frist unter „Nach dem Ende eines Zugangs“ gehen Geräte, Passkeys und E-Mail; der Name bleibt in den Nachweisen.',
} as const
