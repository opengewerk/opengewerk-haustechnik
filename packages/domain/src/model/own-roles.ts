import type { Problems } from './fields.js'
import { type Right, rightLabel, rights, roleKeys } from './rights.js'

/**
 * Roles a tenant makes for itself (section 7 of the concept, #346, decided by
 * Moritz on 15.10.2026): whoever keeps the accesses makes one, chooses its
 * rights from the catalogue, changes and removes it. The roles the
 * application ships stay as they are; a role of the tenant's own can start
 * from one of them. Its rows are the foundation's (`tenant_roles`), read on
 * every request, so a change holds at the next request of everybody with the
 * role.
 */

/**
 * The rights that stay with the role that leads and that no role of the
 * tenant's own is given:
 *
 * - Reading the change log, which a works council is told only the Leitung
 *   reads (section 9 of the concept, decision 30 of phase 2).
 * - Looking at and keeping the accesses: whoever hands out roles can hand
 *   themselves the leading one, and a right whoever holds it can widen is no
 *   boundary.
 * - The mail server, a way of writing in the name of the tenant to anybody.
 * - Delegating duties, which the Leitung signs for the operator.
 */
export const leadingRights = [
  'duty.delegate',
  'membership.read',
  'membership.write',
  'mail.read',
  'mail.write',
  'audit.read',
] as const satisfies readonly Right[]

/** The rights a role of the tenant's own may hold, in the order of the catalogue. */
export const offerableRights: readonly Right[] = rights.filter(
  (right) => !(leadingRights as readonly Right[]).includes(right),
)

/**
 * What comes with a right: whoever may change something sees it (decided on
 * 15.10.2026), and whoever sees the deadlines sees the contracts whose dates
 * they are, because the list of the deadlines names a contract with its firm
 * and its day (the seam of #329). A screen ticks what comes with a right and
 * keeps it ticked; the server adds it whatever it was sent.
 */
export const impliedRights: Readonly<Partial<Record<Right, readonly Right[]>>> = {
  'location.write': ['location.read'],
  'room.record': ['location.read'],
  'asset.record': ['asset.read'],
  'asset.write': ['asset.read'],
  'reading.write': ['asset.read'],
  'duty.write': ['duty.read'],
  'qualification.write': ['qualification.read'],
  'deadline.read': ['contract.read'],
  'deadline.write': ['deadline.read'],
  'activity.perform': ['activity.read'],
  'activity.write': ['activity.read'],
  'template.write': ['activity.read'],
  'activity.accept': ['activity.read'],
  'evidence.write': ['evidence.read'],
  'defect.report': ['defect.read'],
  'defect.write': ['defect.read'],
  'document.record': ['document.read'],
  'document.remove': ['document.read'],
  'task.record': ['task.read'],
  'task.assign': ['task.read'],
  'store.write': ['store.read'],
  'contractor.write': ['contractor.read'],
  'contract.write': ['contract.read'],
  'settings.write': ['settings.read'],
  'sync.write': ['sync.read'],
}

/** The rights chosen with everything that comes with them, in the order of the catalogue. */
export function withImplied(chosen: readonly Right[]): Right[] {
  const held = new Set<Right>(chosen)
  let grew = true

  while (grew) {
    grew = false

    for (const right of [...held]) {
      for (const comes of impliedRights[right] ?? []) {
        if (!held.has(comes)) {
          held.add(comes)
          grew = true
        }
      }
    }
  }

  return rights.filter((right) => held.has(right))
}

/** Which chosen right brings another one with it, for the line under a box that cannot be cleared; null for none. */
export function impliedBy(right: Right, chosen: readonly Right[]): Right | null {
  return (
    chosen.find(
      (each) => each !== right && withImplied([each]).includes(right) && !isLeading(each),
    ) ?? null
  )
}

function isLeading(right: Right): boolean {
  return (leadingRights as readonly Right[]).includes(right)
}

/** Whether a key is that of a role the application ships, which stays as it is. */
export function isShippedRole(key: string): boolean {
  return (roleKeys as readonly string[]).includes(key)
}

/** The bounds of a role of the tenant's own, the same as those of its row (`tenant_roles_label_shaped`). */
export const ownRoleLimits = { label: 80 } as const

/** What a screen and a refusal say about a role of the tenant's own. */
export const ownRoleWords = {
  shippedStays:
    'Eine mitgelieferte Rolle bleibt, wie sie ist. Eine eigene Rolle kann von ihr ausgehen und dann anders zugeschnitten werden.',
  missing: 'Diese Rolle gibt es nicht oder nicht mehr.',
  labelTaken: (label: string) => `Eine Rolle „${label}“ gibt es bei diesem Betreiber schon.`,
  inUse: (holders: number, invited: number) =>
    `Die Rolle ist noch ${[
      holders === 0 ? null : `${String(holders)} ${holders === 1 ? 'Zugang' : 'Zugängen'}`,
      invited === 0
        ? null
        : `${String(invited)} ${invited === 1 ? 'offenen Einladung' : 'offenen Einladungen'}`,
    ]
      .filter(Boolean)
      .join(' und ')} zugeordnet. Erst eine andere Rolle geben, dann entfernen.`,
  changeHolds: 'Eine Änderung gilt beim nächsten Aufruf jeder Person mit dieser Rolle.',
} as const

/**
 * What is wrong with a role of the tenant's own, one sentence per field.
 * Undefined is a field that was not given, as in a change of other fields,
 * and is not asked about. Its rights are keys of the catalogue, at least one,
 * none that stays with the Leitung.
 */
export function ownRoleProblems(role: {
  readonly label?: unknown
  readonly rights?: unknown
  readonly secondFactor?: unknown
}): Problems {
  const problems: Problems = {}

  if (role.label !== undefined) {
    const label = typeof role.label === 'string' ? role.label.trim() : ''

    if (label === '') {
      problems['label'] = 'Die Bezeichnung fehlt.'
    } else if (label.length > ownRoleLimits.label) {
      problems['label'] = `Die Bezeichnung hat höchstens ${String(ownRoleLimits.label)} Zeichen.`
    }
  }

  if (role.rights !== undefined) {
    const given = Array.isArray(role.rights) ? (role.rights as unknown[]) : null
    const unknown = given?.filter((each) => !(rights as readonly unknown[]).includes(each)) ?? []
    const leading = (given ?? []).filter((each): each is Right =>
      (leadingRights as readonly unknown[]).includes(each),
    )

    if (given === null || unknown.length > 0) {
      problems['rights'] = 'Die Rechte sind Rechte aus dem Katalog dieser Anwendung.'
    } else if (leading.length > 0) {
      problems['rights'] =
        `${leading.map((each) => `„${rightLabel[each]}“`).join(', ')} ${leading.length === 1 ? 'bleibt' : 'bleiben'} der Leitung.`
    } else if (given.length === 0) {
      problems['rights'] = 'Eine Rolle ohne ein Recht kann nichts. Mindestens eines wählen.'
    }
  }

  if (role.secondFactor !== undefined && typeof role.secondFactor !== 'boolean') {
    problems['secondFactor'] = 'Ob die Rolle einen zweiten Faktor verlangt, ist ja oder nein.'
  }

  return problems
}

/**
 * The rights a later version brought that a role of the tenant's own did not
 * have to choose from when it was last saved, and does not hold: they reach
 * it not by themselves, and whoever keeps the roles is told there are some
 * (section 7 of the concept). None for a shipped role, which a migration
 * gives a new right where it is owed one.
 */
export function newRightsOf(role: {
  readonly key: string
  readonly rights: readonly string[]
  readonly offeredRights: readonly string[]
}): Right[] {
  return isShippedRole(role.key)
    ? []
    : offerableRights.filter(
        (right) => !role.offeredRights.includes(right) && !role.rights.includes(right),
      )
}

/** A role as the list of the roles shows it. */
export interface RoleEntry {
  readonly key: string
  readonly label: string
  readonly rights: readonly string[]
  readonly leads: boolean
  readonly secondFactor: boolean
  /** One of the roles the application ships, which stays as it is. */
  readonly shipped: boolean
  /** How many memberships name it, blocked ones included. */
  readonly holders: number
  /** How many invitations that are still open name it. */
  readonly invited: number
  /** The rights a later version brought that it does not hold (`newRightsOf`). */
  readonly newRights: readonly Right[]
}

/** The groups a screen shows the rights of a role in, each with the rights of the catalogue in it. */
export const rightGroups: readonly { readonly title: string; readonly rights: readonly Right[] }[] =
  [
    {
      title: 'Orte und Anlagen',
      rights: [
        'location.read',
        'location.write',
        'room.record',
        'asset.read',
        'asset.record',
        'asset.write',
        'reading.write',
      ],
    },
    {
      title: 'Pflichten und Fristen',
      rights: [
        'duty.read',
        'duty.write',
        'qualification.read',
        'qualification.write',
        'deadline.read',
        'deadline.write',
      ],
    },
    {
      title: 'Vorgänge',
      rights: [
        'activity.read',
        'activity.perform',
        'activity.write',
        'template.write',
        'activity.accept',
      ],
    },
    {
      title: 'Nachweise und Mängel',
      rights: ['evidence.read', 'evidence.write', 'defect.read', 'defect.report', 'defect.write'],
    },
    { title: 'Störungen', rights: ['fault.report', 'fault.accept'] },
    {
      title: 'Dokumente und Aufgaben',
      rights: [
        'document.read',
        'document.record',
        'document.remove',
        'task.read',
        'task.record',
        'task.assign',
      ],
    },
    {
      title: 'Lager, Fremdfirmen und Verträge',
      rights: [
        'store.read',
        'store.write',
        'contractor.read',
        'contractor.write',
        'contract.read',
        'contract.write',
      ],
    },
    {
      title: 'Auswertungen und Einstellungen',
      rights: ['report.read', 'settings.read', 'settings.write'],
    },
    { title: 'Gerät', rights: ['sync.read', 'sync.write', 'push.write'] },
  ]
