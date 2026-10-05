import {
  type MemberIdentity,
  rightsCatalogue,
  type RoleDefinition,
} from '@opengewerk/platform-domain'

/**
 * What somebody may do with what a tenant keeps (section 7 of the concept).
 *
 * Rights are cut along what is done and not along screens: hiding a button is
 * a courtesy, refusing the action is the rule. A key is `thing.verb`, in the
 * names of ADR 0002. Where the concept has two words for what is done to one
 * thing, there are two rights:
 *
 * - `record` is "aufnehmen": bringing a room or an asset into being on site
 *   and completing and correcting what is known about it, which is what taking
 *   stock needs. `write` is "pflegen": what has consequences beyond the
 *   record itself. For a document `record` is "ablegen", a first version as
 *   well as the next.
 * - `perform` is "ausführen": the work on an activity up to the signature.
 *   `write` on an activity is planning and assigning, `accept` is the second
 *   signature.
 * - `report` is "melden": putting a defect on record. `write` on a defect is
 *   where it goes from there.
 *
 * The table in section 7 of the concept is this list with its labels, and a
 * test in the server package holds one against the other. A right added here
 * is added there, and the other way round.
 *
 * Where somebody may do it is a second question with a second mechanism: a
 * right holds in the areas of the person, and the database draws that line
 * (ADR 0003).
 */
export const rights = [
  'location.read',
  /**
   * The structure a tenant's places hang in: properties, buildings and floors,
   * and moving or removing a room. The federal state of a property and the
   * kind of a building decide which duties are proposed, and a property names
   * its area, so this stays with those who see every area.
   */
  'location.write',
  /**
   * Bringing a room into being and completing what is known about it. Apart
   * from the structure above it on purpose: taking stock on site meets rooms
   * nobody has entered yet, and whoever stands in one must be able to record
   * it without being able to rearrange a property.
   */
  'room.record',
  'asset.read',
  /**
   * Bringing an asset or a component into being and completing and correcting
   * its master data, its characteristics, its photo and its label. Changing
   * the characteristics changes which duties are proposed and nothing else:
   * a duty is confirmed by a person, and a confirmed one does not change
   * quietly (ADR 0002, point 11).
   */
  'asset.record',
  /**
   * What has consequences beyond the record: the life cycle, because the
   * duties of an asset rest once it is out of service, replacing an asset,
   * moving it to another place, and removing it. A right that could make an
   * overdue inspection disappear is not one for everybody who may enter a
   * serial number.
   */
  'asset.write',
  /**
   * Entering what a meter shows. A reading is never changed, it is corrected
   * by a new one; replacing a meter and taking one out of service are care of
   * the asset and need `asset.write`.
   */
  'reading.write',
  'duty.read',
  /**
   * The register of duties: confirming or dismissing what the catalogue
   * proposes, adding duties of the tenant's own, setting an interval within
   * what the kind of duty allows, and saying who answers for a duty and who
   * performs it.
   */
  'duty.write',
  /**
   * The list of what is due, kept by the deadline engine of the foundation,
   * and the settings of a deadline: its lead time and who is reminded. A
   * deadline is never created by anybody, it follows from its source.
   */
  'deadline.read',
  'deadline.write',
  'activity.read',
  /**
   * The work on a round, an inspection, a maintenance or a work order:
   * answers, measurements, notes and photos, and handing it in with a
   * signature. The evidence that comes of it needs no further right.
   */
  'activity.perform',
  /**
   * What happens before the work: planning rounds, creating and assigning
   * work orders, and closing an open round of a past period with a reason.
   */
  'activity.write',
  /**
   * The second signature: accepting a work order or sending it back, and
   * countersigning a round whose template asks for it. A right of its own, so
   * that a tenant can have somebody who assigns the work without being the
   * one who signs it off.
   */
  'activity.accept',
  'evidence.read',
  /**
   * Entering the report of a contractor or an inspection body as evidence,
   * correcting evidence by a new one that names the old, and declaring one
   * void with a reason. All three leave what was there readable.
   *
   * There is no right that changes or removes evidence, and that is not an
   * omission: the database refuses both for every role (ADR 0004), and a
   * right to lift that would be the most sought after one in the application.
   */
  'evidence.write',
  'defect.read',
  /** Putting a defect on record at an asset or a place, with a remark and a photo. */
  'defect.report',
  /** Where a defect goes from there: its class, its time limit and its status. */
  'defect.write',
  /**
   * Filing a document: sending the bytes of a file to the store and naming
   * them in a record at a place, an asset or an activity, a photo taken on
   * site included. A new version is filed like a first one, and none is ever
   * changed. The store takes the bytes under this right ahead of the record,
   * because a device without a network holds both and sends the bytes first;
   * bytes no record names are in reach of nobody.
   */
  'document.record',
  /**
   * Taking what has changed onto a device, and sending what it queued up
   * without a network. The rights the foundation asks for on the routes of the
   * sync (ADR 0006). A different way in, not a different thing to do: what an
   * operation may touch is still decided by the rights above, entity by
   * entity, so every role has both.
   */
  'sync.read',
  'sync.write',
  /**
   * Who works for this tenant, what they may do, and whether they still get
   * in. The rights the foundation asks for on its own routes; only the role
   * that leads holds them, because somebody who can hand out roles can hand
   * themselves the leading one, and a right that whoever holds it can widen
   * is not a boundary.
   */
  'membership.read',
  'membership.write',
  /** What the tenant has set for itself. Not what a regulation says, that is nobody's to set. */
  'settings.read',
  'settings.write',
  /**
   * Reading the change log: every field before and after, with who and when.
   * Only the role that leads holds it, which is also what a works council is
   * told (section 9 of the concept).
   */
  'audit.read',
] as const

export type Right = (typeof rights)[number]

/**
 * The rights of this application as the foundation reads them (ADR 0010
 * there): what the roles of a tenant add up to is asked of this, and a right
 * a row holds and this list does not know gives nothing. Refused when it is
 * made without the two rights the foundation asks for on its own routes.
 */
export const applicationRights = rightsCatalogue(rights)

/**
 * What a right lets somebody do, in the words of the people who work with the
 * application. Written as the thing done, so that a refusal can say what an
 * access may not do without naming a key nobody outside the code has seen,
 * and so that a tenant reads the same words when it puts together a role of
 * its own. The same words stand in section 7 of the concept.
 */
export const rightLabel: Readonly<Record<Right, string>> = {
  'location.read': 'Liegenschaften, Gebäude und Räume ansehen',
  'location.write': 'Liegenschaften, Gebäude und Geschosse pflegen',
  'room.record': 'Räume aufnehmen',
  'asset.read': 'Anlagen ansehen',
  'asset.record': 'Anlagen aufnehmen',
  'asset.write': 'Anlagen pflegen',
  'reading.write': 'Zähler ablesen',
  'duty.read': 'Pflichten ansehen',
  'duty.write': 'Das Pflichtenverzeichnis führen',
  'deadline.read': 'Fristen ansehen',
  'deadline.write': 'Fristen bearbeiten',
  'activity.read': 'Vorgänge ansehen',
  'activity.perform': 'Vorgänge ausführen',
  'activity.write': 'Vorgänge planen und verteilen',
  'activity.accept': 'Aufträge abnehmen und Rundgänge gegenzeichnen',
  'evidence.read': 'Nachweise ansehen',
  'evidence.write': 'Nachweise eintragen, berichtigen und für ungültig erklären',
  'defect.read': 'Mängel ansehen',
  'defect.report': 'Mängel melden',
  'defect.write': 'Mängel führen',
  'document.record': 'Dokumente ablegen',
  'sync.read': 'Daten abgleichen',
  'sync.write': 'Änderungen senden',
  'membership.read': 'Zugänge ansehen',
  'membership.write': 'Zugänge verwalten',
  'settings.read': 'Einstellungen ansehen',
  'settings.write': 'Einstellungen ändern',
  'audit.read': 'Das Änderungsprotokoll einsehen',
}

/**
 * The sentence a refusal over a missing right says, the same from a route as
 * from the sync. A right is never given alone but with a role, so the way out
 * it names is whoever leads the tenant and the screen where roles are given.
 */
export function missingRight(right: Right): string {
  return (
    `${rightLabel[right]} darf dieser Zugang nicht. ` +
    'Die Leitung vergibt die Rollen unter „Zugänge“.'
  )
}

/**
 * The roles a tenant starts with, the four of phase 1. Section 7 of the
 * concept names three more: the reporter and the auditor come with phase 2,
 * the contractor with phase 4.
 *
 * They are rows of the tenant from the moment it comes into being, and what
 * somebody may do is read from those rows (ADR 0010 in the repository
 * opengewerk). This list is what a new tenant is given.
 */
export const roleKeys = [
  'management',
  'technical_management',
  'site_management',
  'technician',
] as const

export type RoleKey = (typeof roleKeys)[number]

/**
 * "Haustechnik": the work on site within one's areas. Looking at what is
 * there, taking stock, doing rounds, inspections and work orders, reading
 * meters, and putting a defect on record.
 */
const technician: readonly Right[] = [
  'location.read',
  'room.record',
  'asset.read',
  'asset.record',
  'reading.write',
  // What is due at an asset, and what the round at hand fulfils.
  'duty.read',
  'activity.read',
  'activity.perform',
  // The last evidence of a duty is the template of the next protocol.
  'evidence.read',
  'defect.read',
  'defect.report',
  // A photo at an asset or at a defect is filed like any other document.
  'document.record',
  // Every device takes and sends; what it may touch the rights above decide.
  'sync.read',
  'sync.write',
]

/**
 * "Objektleitung": plans and hands out the work in its areas and signs it
 * off, and takes care of the assets there. Not the structure of the
 * properties and not the register of duties, which belong to those who see
 * every area.
 */
const siteManagement: readonly Right[] = [
  ...technician,
  'asset.write',
  'activity.write',
  'activity.accept',
  'evidence.write',
  'defect.write',
]

/**
 * "Technische Leitung": answers for the duties of the tenant across every
 * area. The register of duties, the deadlines and the structure the duties
 * follow from. Not who works for the tenant, not its settings and not its
 * change log.
 */
const technicalManagement: readonly Right[] = [
  ...siteManagement,
  'location.write',
  'duty.write',
  'deadline.read',
  'deadline.write',
]

/** In the order of the catalogue, which is the order a screen lists them in. */
function inOrder(held: readonly Right[]): readonly Right[] {
  return rights.filter((right) => held.includes(right))
}

/** A role this application ships: one of the four keys, with rights of its catalogue. */
export type ShippedRole = RoleDefinition<Right> & { readonly key: RoleKey }

/**
 * The four roles as the rows a tenant starts with, in the order a screen
 * lists them. Each holds what the one after it holds.
 *
 * Whether a role leads and whether it works only with a second factor are
 * flags of the role and no rights, so that no role can lose either by losing
 * a right: the last one who leads a tenant neither loses the role nor is shut
 * out, and whoever leads signs in with a second factor (sections 3 and 7 of
 * the concept).
 */
export const shippedRoles: readonly ShippedRole[] = [
  { key: 'management', label: 'Leitung', rights, leads: true, secondFactor: true },
  {
    key: 'technical_management',
    label: 'Technische Leitung',
    rights: inOrder(technicalManagement),
    leads: false,
    secondFactor: false,
  },
  {
    key: 'site_management',
    label: 'Objektleitung',
    rights: inOrder(siteManagement),
    leads: false,
    secondFactor: false,
  },
  {
    key: 'technician',
    label: 'Haustechnik',
    rights: inOrder(technician),
    leads: false,
    secondFactor: false,
  },
]

/**
 * Who is asking. The tenant decides whose data is in reach and the areas which
 * part of it, both in the database; the rights decide what may be done with
 * it, in the server.
 *
 * The rights are what the roles of the membership add up to, resolved from
 * the rows of the tenant when the request came in. `roles` are the keys the
 * membership names, kept for whoever wants to say which.
 */
export type Identity = MemberIdentity<Right>

/**
 * Every right these of the four shipped roles add up to, as this version
 * defines them.
 *
 * Not what somebody may do: that is read from the rows of the tenant and
 * asked through `isAllowed`. This is for where no row is at hand: a test that
 * stands in for somebody with a role, and the preview.
 */
export function rightsOfRoles(keys: readonly RoleKey[]): ReadonlySet<Right> {
  return new Set(
    applicationRights.sumOf(shippedRoles.filter((role) => keys.includes(role.key))).rights,
  )
}

/**
 * Whether somebody holds a right. The one question, wherever it is asked: by
 * the guard in front of a route, by the sync, and by a screen that decides
 * what to offer.
 *
 * On a screen that is a courtesy and not a gate: the gate is the guard on the
 * server, which asks on every request.
 */
export function isAllowed(identity: Pick<Identity, 'rights'>, right: Right): boolean {
  return applicationRights.isAllowed(identity, right)
}
