import {
  attachmentVersionPolicy,
  type Operation,
  type SyncPolicy,
  syncRules,
  type SyncValue,
} from '@opengewerk/platform-domain'

/**
 * Changed only with a connection, through the routes of the office (ADR 0006,
 * point 6): "no" in the table there means "not without a connection" and not
 * "never". A device holds these records to read them.
 */
const officeOnly: SyncPolicy = { create: false, change: 'never' }

/** The states of an activity while its work goes on, before a signature fixes it. */
const inProgress: readonly SyncValue[] = ['open', 'started']

/**
 * The states of an activity a signature is given in: while its work goes on,
 * and once signed, for the countersignature (ADR 0004, point 8).
 */
const toBeSigned: readonly SyncValue[] = [...inProgress, 'signed']

/**
 * What a device may create and change of each kind of record, and what it
 * holds (ADR 0006, point 6). Every table that carries the columns of the sync
 * has one, and a test holds each to a table and each table to one.
 *
 * The fields the server works out are reserved: the area of every row, which
 * follows its property, the property and building where they follow the
 * record a row hangs on, and the numbers drawn from a sequence (point 8). A
 * device that sends one gets the conflict `set_by_server`. What a device may
 * write beyond that is narrower than "create" and "merge" say, field by
 * field, and stands in `offlineEdits`.
 */
export const syncPolicies: Readonly<Record<string, SyncPolicy>> = {
  // The places: the office keeps them, with a connection.
  properties: officeOnly,
  buildings: officeOnly,
  floors: officeOnly,
  // The people to talk to at a property: whoever keeps the properties keeps
  // them, and a device holds them to read and to call.
  contacts: officeOnly,
  // The times a building is closed: whoever plans the rounds enters them, and
  // a device holds them to read.
  building_closures: officeOnly,
  // A room is taken stock of on site; its building, property and area follow
  // its floor.
  rooms: { create: true, change: 'merge', reserved: ['buildingId', 'propertyId', 'areaId'] },
  // An asset and its components: taken stock of and completed on site, with
  // the number the server draws.
  assets: { create: true, change: 'merge', reserved: ['number', 'propertyId', 'areaId'] },
  // Its life cycle has consequences beyond the record: its duties rest while
  // it is out of service.
  asset_lifecycle: officeOnly,
  asset_supplies: { create: true, change: 'merge', reserved: ['propertyId', 'areaId'] },
  // The register of duties: the office keeps it.
  duties: officeOnly,
  duty_dismissals: officeOnly,
  // An activity takes its progress from a device while its work goes on; a
  // signature or the office ends it, and then a device corrects nothing. One
  // made on a device names its state, so that the gate finds one before the
  // server has answered.
  activities: {
    create: true,
    change: 'merge',
    onlyWhile: { field: 'status', values: inProgress },
    // The form it is filled in is the server's, written when it is made (#106).
    reserved: ['areaId', 'formKey', 'formVersion'],
  },
  // The result of each duty, until the activity is signed.
  activity_duties: {
    create: false,
    change: 'merge',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['propertyId', 'areaId'],
  },
  // The answer to one point of the form of an activity, a row per point (ADR
  // 0006, point 7): given, changed and taken back on site while the work
  // goes on, fixed by the signature. Property and area follow the activity.
  activity_answers: {
    create: true,
    change: 'merge',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['propertyId', 'areaId'],
  },
  work_orders: {
    create: true,
    change: 'never',
    reserved: ['number', 'activityKind', 'propertyId', 'areaId'],
  },
  // The answer a defect came of is the server's, written with the signature (#106).
  defects: { create: true, change: 'merge', reserved: ['areaId', 'foundInAnswerId'] },
  // A signature is given on the device, also without a connection, and never
  // changed (ADR 0004, point 10). Who gave it is the person signed in, and
  // the server writes what comes of it: the evidence, once every signature
  // the activity calls for is there. The decision on a work order is the
  // office's.
  activity_signatures: {
    create: true,
    change: 'never',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: toBeSigned,
    },
    reserved: ['propertyId', 'areaId', 'signedBy'],
  },
  work_order_decisions: officeOnly,
  // A document is filed in the office and on site, also without a connection:
  // a photo of a type plate waits on the device with its bytes. Its name and
  // its kind are corrected afterwards; what it hangs on stays. The area
  // follows its property.
  attachments: { create: true, change: 'merge', reserved: ['areaId'] },
  // A version is made and never changed, and who filed it is the server's to
  // write. It carries no place: it is seen with its document.
  attachment_versions: attachmentVersionPolicy,
  // A label is made and blocked in the office, with a connection: the server
  // draws its code. A device holds the labels of its places, so that a scan
  // opens an asset without a network, and it gives a label from a sheet to an
  // asset it takes stock of, also without one. A blocked label takes nothing.
  // Its code, its property and its area are the server's.
  labels: {
    create: false,
    change: 'merge',
    onlyWhile: { field: 'blockedAt', values: [null] },
    reserved: ['code', 'propertyId', 'areaId'],
  },
}

/**
 * How many days a closed activity stays on the device of whoever worked on it
 * (ADR 0006, point 3): long enough to look up what was done last week without
 * a network, short enough that a device does not carry every round of the
 * year. Counted from its last change, which for a closed activity is its
 * closing. Whoever sees every area holds every activity.
 */
export const closedActivitiesStayDays = 30

/**
 * The rules the server and every device decide by, made once from the
 * policies: so that a device works out the answer the server will give.
 */
export const offlineRules = syncRules(syncPolicies)

/** The kinds of record a device keeps, in the order of the policies. */
export const syncEntities = offlineRules.entities

/** Every value of a field, or only these. */
export type OfflineValues = true | readonly SyncValue[]

/**
 * What a device may write without a connection, field by field, where its
 * policy lets it create or change a record at all (ADR 0006, point 6): the
 * fields of a record it creates, the fields of one it changes, each with the
 * values it may give, and whether it may remove a record. Anything else needs
 * a connection, and so does removing a record without `remove`: the office
 * does it through the route of the record.
 *
 * The fields the server works out are reserved in the policy and not named
 * here; the merge answers them before this is asked.
 */
export interface OfflineEdits {
  readonly create?: Readonly<Record<string, OfflineValues>>
  readonly change?: Readonly<Record<string, OfflineValues>>
  readonly remove?: true
}

/** What is known about an asset, as the route that completes one takes it. */
const assetDetails: Readonly<Record<string, OfflineValues>> = {
  kind: true,
  name: true,
  mark: true,
  manufacturer: true,
  model: true,
  serialNumber: true,
  yearBuilt: true,
  commissionedOn: true,
  warrantyEndsOn: true,
  values: true,
  meterNumber: true,
  meterUnit: true,
}

/** The place a record that belongs to one hangs on (ADR 0002, point 10). */
const placeTarget: Readonly<Record<string, OfflineValues>> = {
  propertyId: true,
  buildingId: true,
  roomId: true,
  assetId: true,
}

export const offlineEdits: Readonly<Record<string, OfflineEdits>> = {
  // A room on its floor, with its number, name and use. Moving it to another
  // floor and removing it is for whoever keeps the places.
  rooms: {
    create: { floorId: true, number: true, name: true, use: true },
    change: { number: true, name: true, use: true },
  },
  // An asset in its building, on request in a room or under another asset.
  // Moving and removing it is "pflegen" and needs a connection.
  // What it was found to be distinct from is said once, when it is entered.
  assets: {
    create: {
      buildingId: true,
      roomId: true,
      parentAssetId: true,
      ...assetDetails,
      distinctFrom: true,
    },
    change: assetDetails,
  },
  // What an asset supplies, one building or room per row: added and taken
  // away on site, never changed in place.
  asset_supplies: {
    create: { assetId: true, buildingId: true, roomId: true },
    remove: true,
  },
  // A work order made on site; rounds, inspections and maintenance are
  // planned in the office. Its progress: started, and the day it was
  // performed on. Who it is given to, when it is due and its place are its
  // plan.
  activities: {
    create: {
      kind: ['work_order'],
      title: true,
      status: inProgress,
      performedOn: true,
      ...placeTarget,
    },
    change: { status: ['started'], performedOn: true },
  },
  // The result of a duty of an activity. Which duties an activity is to meet
  // is its plan.
  activity_duties: { change: { result: true, resultReason: true } },
  // The answer to a point: where it stands in the form, once, and what it
  // says, as long as the work goes on. An answer taken back is removed.
  activity_answers: {
    create: {
      activityId: true,
      groupKey: true,
      blockKey: true,
      fieldKey: true,
      value: true,
      result: true,
      remark: true,
      attachmentId: true,
    },
    change: { value: true, result: true, remark: true, attachmentId: true },
    remove: true,
  },
  // A work order made on site is one for a fault ("Störung").
  work_orders: { create: { activityId: true, kind: ['fault'] } },
  // A signature, with when, on which device and for which page it was given.
  activity_signatures: {
    create: {
      activityId: true,
      role: true,
      signedAt: true,
      deviceInfo: true,
      path: true,
      pageFingerprint: true,
    },
  },
  // A defect is reported with its description and where it was found;
  // afterwards a device completes its description. Its class, the day to set
  // it right by, its status and the work order that does are its further way,
  // kept by whoever keeps defects, with a connection (section 7 of the
  // concept, #116).
  defects: {
    create: {
      description: true,
      foundOn: true,
      foundInActivityId: true,
      ...placeTarget,
    },
    change: { description: true },
  },
  // A document at its property, on request at one record there, with its name
  // and its kind; both are corrected afterwards. Taking it out of the records
  // goes the same way, and asks for a right of its own.
  attachments: {
    create: {
      title: true,
      kind: true,
      propertyId: true,
      buildingId: true,
      roomId: true,
      assetId: true,
      activityId: true,
      defectId: true,
    },
    change: { title: true, kind: true },
    remove: true,
  },
  // A label from a sheet is given to an asset. Blocking it, and giving one to
  // a room, is done at the routes of the office.
  labels: { change: { assetId: true } },
  // A version of a document, with the file it names by its hash.
  attachment_versions: {
    create: {
      attachmentId: true,
      sha256: true,
      fileName: true,
      mediaType: true,
      sizeBytes: true,
      previewSha256: true,
    },
  },
}

/**
 * The fields of an operation that a device may not write without a
 * connection, or null when it may write all of it: a field outside what
 * `offlineEdits` names for its kind of record, a value outside the ones named
 * for a field, or the removal of a record that is not removed on site. An
 * entity without an entry is decided by its policy alone.
 *
 * Asked by the server before the database, as the conflict `online_only` for
 * this one operation, and by a form before it queues anything.
 */
export function offlineEditRefusal(
  operation: Pick<Operation, 'entity' | 'kind' | 'patches'>,
): readonly string[] | null {
  const edits = Object.hasOwn(offlineEdits, operation.entity)
    ? offlineEdits[operation.entity]
    : undefined

  if (!edits) {
    return null
  }

  if (operation.kind === 'delete') {
    return edits.remove ? null : []
  }

  const allowed = (operation.kind === 'create' ? edits.create : edits.change) ?? {}
  const refused = operation.patches
    .filter((patch) => {
      const values = Object.hasOwn(allowed, patch.field) ? allowed[patch.field] : undefined

      return values === undefined || (values !== true && !values.includes(patch.to))
    })
    .map((patch) => patch.field)

  return refused.length === 0 ? null : refused
}

/**
 * What each kind of record of the sync is called, over a conflict and in its
 * sentences (ADR 0006). The test beside this file holds it against the
 * policies.
 */
export const syncEntityNames: Readonly<Record<string, string>> = {
  properties: 'Liegenschaft',
  buildings: 'Gebäude',
  floors: 'Geschoss',
  contacts: 'Ansprechpartner',
  building_closures: 'Schließzeit',
  rooms: 'Raum',
  assets: 'Anlage',
  asset_lifecycle: 'Lebenszyklus einer Anlage',
  asset_supplies: 'Versorgungsbereich einer Anlage',
  duties: 'Pflicht',
  duty_dismissals: 'Verworfener Vorschlag',
  activities: 'Vorgang',
  activity_duties: 'Pflicht eines Vorgangs',
  activity_answers: 'Antwort',
  work_orders: 'Arbeitsauftrag',
  defects: 'Mangel',
  activity_signatures: 'Unterschrift',
  work_order_decisions: 'Abnahme eines Auftrags',
  attachments: 'Dokument',
  attachment_versions: 'Fassung eines Dokuments',
  labels: 'Etikett',
}

/**
 * What each field of the sync is called, at the head of its row in a conflict.
 * One name per field and not per kind of record: the card names the record
 * above its fields, so "Art" under "Anlage" says what "Anlagenart" says in
 * the change log. A test of the server holds every field a device may write
 * against this list; what only the server writes never reaches a conflict.
 */
export const syncFieldNames: Readonly<Record<string, string>> = {
  // The place, and what a row hangs on. A property names its area, which
  // the office chooses; every other row takes it from its property.
  areaId: 'Bereich',
  propertyId: 'Liegenschaft',
  buildingId: 'Gebäude',
  floorId: 'Geschoss',
  roomId: 'Raum',
  assetId: 'Anlage',
  parentAssetId: 'Gehört zu',
  activityId: 'Vorgang',
  dutyId: 'Pflicht',
  workOrderId: 'Arbeitsauftrag',
  foundInActivityId: 'Festgestellt bei',
  foundInEvidenceId: 'Genannt im Nachweis',
  remedyWorkOrderId: 'Beseitigt mit',
  defectId: 'Mangel',
  // What is said about a place.
  name: 'Bezeichnung',
  street: 'Straße',
  postalCode: 'Postleitzahl',
  city: 'Ort',
  federalState: 'Bundesland',
  note: 'Notiz',
  shortCode: 'Kürzel',
  kinds: 'Gebäudearten',
  yearBuilt: 'Baujahr',
  level: 'Ebene',
  number: 'Nummer',
  use: 'Nutzung',
  // What is said about somebody to talk to at a property. What somebody is
  // there shares its entry with the role of a signature below; a device
  // writes no contact, so the field of a contact never stands in a conflict.
  givenName: 'Vorname',
  familyName: 'Nachname',
  phone: 'Telefon',
  email: 'E-Mail',
  // What is said about a time a building is closed. Its last day and what it
  // is for share their entries with a duty below; a device writes no closure,
  // so the field of a closure never stands in a conflict.
  startsOn: 'Beginnt am',
  // What is said about an asset.
  kind: 'Art',
  mark: 'Kennzeichen',
  manufacturer: 'Hersteller',
  model: 'Typ',
  serialNumber: 'Seriennummer',
  commissionedOn: 'Inbetriebnahme',
  warrantyEndsOn: 'Ende der Gewährleistung',
  values: 'Angaben der Anlagenart',
  meterNumber: 'Zählernummer',
  meterUnit: 'Einheit des Zählers',
  distinctFrom: 'Für eine andere befunden als',
  state: 'Zustand',
  validFrom: 'Ab',
  // What is said about a duty.
  kindVersion: 'Fassung der Art',
  label: 'Bezeichnung',
  basis: 'Grundlage',
  sourceNote: 'Quelle',
  task: 'Tätigkeit',
  counting: 'Zählweise',
  intervalDays: 'Frist in Tagen',
  intervalMonths: 'Frist in Monaten',
  intervalReason: 'Begründung der Frist',
  maximumDays: 'Höchstfrist in Tagen',
  maximumMonths: 'Höchstfrist in Monaten',
  responsibleUserId: 'Verantwortlich',
  performer: 'Ausgeführt von',
  performerNote: 'Fremdfirma',
  confirmedBy: 'Bestätigt von',
  confirmedAt: 'Bestätigt am',
  endsOn: 'Endet am',
  endReason: 'Grund für das Ende',
  reason: 'Grund',
  dismissedBy: 'Verworfen von',
  // What is said about an activity and the work on it.
  title: 'Bezeichnung',
  status: 'Stand',
  dueOn: 'Fällig am',
  performerUserId: 'Ausgeführt von',
  contractorNote: 'Fremdfirma',
  closingReason: 'Grund',
  performedOn: 'Durchgeführt am',
  countersignatureRequired: 'Gegenzeichnung verlangt',
  result: 'Ergebnis',
  resultReason: 'Grund',
  // What is said about the answer to a point of a form. Its result shares
  // its entry with the result of a duty above, its photo with a document
  // below.
  groupKey: 'Gruppe',
  blockKey: 'Block',
  fieldKey: 'Punkt',
  value: 'Wert',
  remark: 'Bemerkung',
  // What is said about a defect.
  description: 'Beschreibung',
  defectClass: 'Klasse',
  foundOn: 'Festgestellt am',
  checkedOn: 'Nachgeprüft am',
  checkNote: 'Bemerkung zur Nachprüfung',
  // A signature, and a decision on a work order.
  signedBy: 'Unterschrieben von',
  role: 'Als',
  signedAt: 'Unterschrieben am',
  deviceInfo: 'Gerät',
  path: 'Linienzug',
  pageFingerprint: 'Fingerabdruck der Seite',
  decision: 'Entscheidung',
  decidedBy: 'Entschieden von',
  decidedAt: 'Entschieden am',
  // What is said about a document and a version of it. Its name and its kind
  // share their entries with an activity and an asset above.
  attachmentId: 'Dokument',
  sha256: 'Prüfsumme',
  fileName: 'Dateiname',
  mediaType: 'Dateityp',
  sizeBytes: 'Größe',
  previewSha256: 'Vorschau',
  // What is said about a label. A device gives one to an asset, which shares
  // its entry with every record that hangs on one; neither of these two ever
  // stands in a conflict.
  code: 'Code',
  blockedAt: 'Gesperrt am',
}
