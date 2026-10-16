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

/**
 * The property a row names a second time where it hangs on the property
 * itself, for the key of its area (ADR 0003, addendum of #306). A trigger
 * fills it, and no device and no form writes it.
 */
const areaFromProperty = 'areaFromPropertyId'

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
  buildings: { ...officeOnly, reserved: [areaFromProperty] },
  floors: officeOnly,
  // The people to talk to at a property: whoever keeps the properties keeps
  // them, and a device holds them to read and to call.
  contacts: officeOnly,
  // The times a building is closed: whoever plans the rounds enters them, and
  // a device holds them to read.
  building_closures: officeOnly,
  // The templates of the rounds and their versions (#112): the office keeps
  // them, and every device holds them to fill a round in the version it
  // names, without a network.
  round_templates: officeOnly,
  round_template_versions: officeOnly,
  // The plans of the rounds (#113): whoever plans and hands out work keeps
  // them, and a device holds those of its areas, to read.
  round_plans: { ...officeOnly, reserved: [areaFromProperty] },
  // A room is taken stock of on site; its building, property and area follow
  // its floor.
  rooms: { create: true, change: 'merge', reserved: ['buildingId', 'propertyId', 'areaId'] },
  // An asset and its components: taken stock of and completed on site, with
  // the number the server draws. Which asset it took the place of says the
  // exchange in the office (#89), and no device.
  assets: {
    create: true,
    change: 'merge',
    reserved: ['number', 'propertyId', 'areaId', 'replacesAssetId'],
  },
  // Its life cycle has consequences beyond the record: its duties rest while
  // it is out of service.
  asset_lifecycle: officeOnly,
  asset_supplies: { create: true, change: 'merge', reserved: ['propertyId', 'areaId'] },
  // The register of duties: the office keeps it.
  duties: { ...officeOnly, reserved: [areaFromProperty] },
  duty_dismissals: officeOnly,
  // An activity takes its progress from a device while its work goes on; a
  // signature or the office ends it, and then a device corrects nothing. One
  // made on a device names its state, so that the gate finds one before the
  // server has answered.
  activities: {
    create: true,
    change: 'merge',
    onlyWhile: { field: 'status', values: inProgress },
    // The form it is filled in is the server's, written when it is made (#106),
    // and so is the day of the protocol it took as its template (#108) and
    // the plan of a round that made it (#113).
    reserved: ['areaId', areaFromProperty, 'formKey', 'formVersion', 'templateOn', 'roundPlanId'],
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
  // How urgent an order is and the defect it came of are the office's (#117).
  // The time spent on it is said on site while the work goes on (#118), and
  // its signature fixes it.
  work_orders: {
    create: true,
    change: 'merge',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['number', 'activityKind', 'propertyId', 'areaId', 'urgency', 'originDefectId'],
  },
  // Who works on a work order besides the person who answers for it (#73):
  // handed out in the office, with a connection, and held by the devices of
  // the people who work on it.
  work_order_participants: { ...officeOnly, reserved: ['activityKind', 'propertyId', 'areaId'] },
  // A note on a work order (#118): written on site while the work goes on,
  // also without a connection, and never changed or removed afterwards. Who
  // wrote it is the person signed in, which the server writes.
  work_order_notes: {
    create: true,
    change: 'never',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['activityKind', 'propertyId', 'areaId', 'writtenBy'],
  },
  // The answer a defect came of is the server's, written with the signature (#106).
  defects: {
    create: true,
    change: 'merge',
    reserved: ['areaId', areaFromProperty, 'foundInAnswerId'],
  },
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
  // The client's signature under the service report of a work order (#324):
  // taken on the device while the work goes on, before the own signature,
  // also without a connection, and never changed. Who held the device is the
  // person signed in, which the server writes, and the server freezes the
  // report from it.
  service_reports: {
    create: true,
    change: 'never',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['propertyId', 'areaId', 'signedBy'],
  },
  // A contractor at work (#330): the briefing of one of its people and the
  // permit for hot work, taken on the device while the order is under way,
  // also without a connection, and never changed. Who held the device is the
  // person signed in, which the server writes.
  briefings: {
    create: true,
    change: 'never',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['propertyId', 'areaId', 'signedBy'],
  },
  work_permits: {
    create: true,
    change: 'never',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['propertyId', 'areaId', 'signedBy'],
  },
  // A document is filed in the office and on site, also without a connection:
  // a photo of a type plate waits on the device with its bytes. Its name and
  // its kind are corrected afterwards; what it hangs on stays. The area
  // follows its property. That it was taken over from a predecessor
  // application only the import of the server says (#130).
  attachments: { create: true, change: 'merge', reserved: ['areaId', areaFromProperty, 'legacy'] },
  // A version is made and never changed, and who filed it is the server's to
  // write. It carries no place: it is seen with its document.
  attachment_versions: attachmentVersionPolicy,
  // What a measuring point holds beside its asset (#119): what only it
  // carries, the replacements of its meter and the periods it rests. Kept in
  // the office, with a connection; a device holds them with the places, to
  // show the reading before and why a meter is not read.
  meter_points: officeOnly,
  meter_exchanges: officeOnly,
  meter_pauses: officeOnly,
  // A reading is made on site without a network, on a round of the meters
  // (#120), and never changed: a wrong one is corrected in the office. Its
  // place and its key date follow its measuring point, how it came is that
  // round, and who read it is the server's to write; a reading of a round is
  // the server's, written with the signature.
  meter_readings: {
    create: true,
    change: 'never',
    reserved: [
      'propertyId',
      'areaId',
      'keyDate',
      'source',
      'activityId',
      'correctsId',
      'correctionReason',
      'recordedBy',
    ],
  },
  // The day of the month the readings of the operator are due on (#120): set
  // under "Einstellungen", held by every device to name the key date.
  meter_settings: officeOnly,
  // Whether the service report names the people who did the work and the
  // times of their notes (#324): set under "Einstellungen", held by every
  // device, whose page of a report says what will stand on it.
  work_order_settings: officeOnly,
  // The stores of the operator (#325): kept in the office, with a
  // connection, and held by every device, which takes from them at a work
  // order (#326). Tenant-wide, without an area.
  articles: officeOnly,
  suppliers: officeOnly,
  stores: officeOnly,
  store_articles: officeOnly,
  stock_movements: officeOnly,
  // The contractors of the operator (#328): kept in the office, with a
  // connection, and held by every device, which names the firm of an order;
  // without the right to see them by their name alone (#377). Tenant-wide,
  // without an area.
  contractors: officeOnly,
  // The contracts with the contractors (#329): kept in the office, with a
  // connection, and held only by the devices of whoever reads them, for the
  // name of the contract a document or a duty names. Tenant-wide, without an
  // area.
  contracts: officeOnly,
  // The labels on the shelves of a store (#326): made in the office, held by
  // every device, which reads them like the barcode of an article.
  store_labels: officeOnly,
  // Material taken for a work order (#326): taken on site while the work goes
  // on, also without a connection, and never changed or removed afterwards.
  // The server books it once in its store. Who took it is the person signed
  // in, which the server writes.
  work_order_materials: {
    create: true,
    change: 'never',
    gateFrom: {
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: inProgress,
    },
    reserved: ['activityKind', 'propertyId', 'areaId', 'takenBy'],
  },
  // A label is made and blocked in the office, with a connection: the server
  // draws its code. A device holds the labels of its places, so that a scan
  // opens an asset without a network, and it gives a label from a sheet to an
  // asset it takes stock of, also without one. A blocked label takes nothing.
  // Its code, its property and its area are the server's.
  labels: {
    create: false,
    change: 'merge',
    onlyWhile: { field: 'blockedAt', values: [null] },
    reserved: ['code', 'propertyId', 'areaId', areaFromProperty],
  },
  // A task is written and done in the office and on site, also without a
  // connection (#124). Its area follows its property, and who wrote it is the
  // server's to say: a device that set it could put its task under somebody
  // else's name, and no person wrote one the deadline engine makes.
  tasks: { create: true, change: 'merge', reserved: ['areaId', areaFromProperty, 'createdBy'] },
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
  // The result of a duty of an activity, with what is said with it (#108).
  // Which duties an activity is to meet is its plan.
  activity_duties: { change: { result: true, resultReason: true, remark: true } },
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
  // A work order made on site is one for a fault ("Störung"); the time spent
  // on an order is said on site (#118).
  work_orders: {
    create: { activityId: true, kind: ['fault'] },
    change: { durationMinutes: true },
  },
  // A note on a work order, with the moment of the device it was written on.
  work_order_notes: { create: { activityId: true, text: true, writtenAt: true } },
  // Material for a work order: which store, which article, how much, and
  // the moment of the device it was taken on (#326).
  work_order_materials: {
    create: {
      activityId: true,
      storeId: true,
      articleId: true,
      quantityMilli: true,
      takenAt: true,
    },
  },
  // A reading of a round of the meters: which meter, the day, the figure, and
  // that a figure far above the one before was confirmed (#120).
  meter_readings: {
    create: { assetId: true, readOn: true, valueMilli: true, jumpConfirmed: true },
  },
  // A signature, with when, on which device and for which page it was given.
  activity_signatures: {
    create: {
      activityId: true,
      role: true,
      signedAt: true,
      deviceInfo: true,
      path: true,
      typedName: true,
      pageFingerprint: true,
    },
  },
  // The client's signature under a service report (#324): the name in block
  // letters, the drawing, when, on which device and for which page.
  service_reports: {
    create: {
      activityId: true,
      clientName: true,
      path: true,
      signedAt: true,
      deviceInfo: true,
      pageFingerprint: true,
    },
  },
  // A briefing (#330): whom of which firm, in what, the drawing, when and on
  // which device; a permit: the form by its key and version and what was
  // entered in it, when and on which device.
  briefings: {
    create: {
      activityId: true,
      contractorId: true,
      personName: true,
      subject: true,
      path: true,
      signedAt: true,
      deviceInfo: true,
    },
  },
  work_permits: {
    create: {
      activityId: true,
      contractorId: true,
      formKey: true,
      formVersion: true,
      answers: true,
      signedAt: true,
      deviceInfo: true,
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
  // A document at its property, on request at one record there, or at a
  // contractor (#328), with its name and its kind; both are corrected
  // afterwards. Taking it out of the records goes the same way, and asks for
  // a right of its own.
  attachments: {
    create: {
      title: true,
      kind: true,
      contractorId: true,
      contractId: true,
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
  // A task with its text, its day and its person, open, at its property and
  // on request at one record there (#124). Afterwards it is marked done and
  // opened again, and nothing else of it changes.
  tasks: {
    create: {
      title: true,
      dueOn: true,
      assigneeUserId: true,
      status: ['open'],
      propertyId: true,
      buildingId: true,
      roomId: true,
      assetId: true,
      activityId: true,
    },
    change: { status: true },
  },
  // A version of a document, with the file it names by its hash.
  attachment_versions: {
    create: {
      attachmentId: true,
      sha256: true,
      fileName: true,
      mediaType: true,
      sizeBytes: true,
      previewSha256: true,
      // The day it expires or is to be reviewed (#327).
      validUntil: true,
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
  round_templates: 'Vorlage eines Rundgangs',
  round_template_versions: 'Fassung einer Vorlage',
  round_plans: 'Plan eines Rundgangs',
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
  work_order_participants: 'Beteiligte Person',
  work_order_notes: 'Notiz zu einem Auftrag',
  defects: 'Mangel',
  activity_signatures: 'Unterschrift',
  work_order_decisions: 'Abnahme eines Auftrags',
  service_reports: 'Leistungsnachweis',
  briefings: 'Einweisung',
  work_permits: 'Erlaubnisschein',
  attachments: 'Dokument',
  attachment_versions: 'Fassung eines Dokuments',
  labels: 'Etikett',
  meter_points: 'Messstelle',
  meter_readings: 'Zählerstand',
  meter_exchanges: 'Zählertausch',
  meter_pauses: 'Stilllegung einer Messstelle',
  meter_settings: 'Stichtag der Zähler',
  work_order_settings: 'Einstellungen der Aufträge',
  articles: 'Artikel',
  suppliers: 'Lieferant',
  stores: 'Lager',
  store_articles: 'Artikel eines Lagers',
  stock_movements: 'Buchung im Lager',
  store_labels: 'Etikett eines Lagerfachs',
  contractors: 'Fremdfirma',
  contracts: 'Vertrag',
  work_order_materials: 'Material am Auftrag',
  tasks: 'Aufgabe',
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
  // The area given to a building itself (#306), which the office sets.
  ownAreaId: 'Eigener Bereich',
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
  measure: 'Einordnung',
  mark: 'Kennzeichen',
  manufacturer: 'Hersteller',
  model: 'Typ',
  serialNumber: 'Seriennummer',
  commissionedOn: 'Inbetriebnahme',
  warrantyEndsOn: 'Ende der Gewährleistung',
  values: 'Angaben der Anlagenart',
  meterNumber: 'Zählernummer',
  meterUnit: 'Einheit des Zählers',
  distinctFrom: 'Keine Dublette von',
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
  intervalDocumentId: 'Dokument, das die Frist trägt',
  intervalDocumentVersionId: 'Fassung dieses Dokuments',
  maximumDays: 'Höchstfrist in Tagen',
  maximumMonths: 'Höchstfrist in Monaten',
  guideDays: 'Richtwert in Tagen',
  guideMonths: 'Richtwert in Monaten',
  keptVersion: 'So gelassen gegenüber Fassung',
  keptDays: 'So gelassen gegenüber einer Frist der Vorschrift in Tagen',
  keptMonths: 'So gelassen gegenüber einer Frist der Vorschrift in Monaten',
  keptReason: 'Begründung, die Pflicht so zu lassen',
  responsibleUserId: 'Verantwortlich',
  assigneeUserId: 'Verantwortlich',
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
  // A further person on a work order (#73), the time spent on an order and a
  // note on it (#118).
  userId: 'Person',
  durationMinutes: 'Dauer',
  text: 'Text',
  writtenAt: 'Geschrieben am',
  takenAt: 'Entnommen am',
  validUntil: 'Gültig bis',
  takenBy: 'Entnommen von',
  materialId: 'Material am Auftrag',
  storeArticleId: 'Artikel eines Lagers',
  writtenBy: 'Geschrieben von',
  contractorNote: 'Fremdfirma',
  contractorId: 'Fremdfirma aus der Liste',
  services: 'Leistungen',
  contractId: 'Vertrag',
  renewalMonths: 'Verlängerung in Monaten',
  noticeAmount: 'Kündigungsfrist',
  noticeUnit: 'Einheit der Kündigungsfrist',
  cancelledTo: 'Gekündigt zum',
  responseTime: 'Reaktionszeit',
  price: 'Preis',
  closingReason: 'Grund',
  performedOn: 'Durchgeführt am',
  countersignatureRequired: 'Gegenzeichnung verlangt',
  templateOn: 'Vorlage vom',
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
  typedName: 'Getippter Name',
  pageFingerprint: 'Fingerabdruck der Seite',
  decision: 'Entscheidung',
  decidedBy: 'Entschieden von',
  decidedAt: 'Entschieden am',
  // The client's signature under a service report (#324), and the setting
  // whether it names the people who did the work.
  clientName: 'Name des Auftraggebers',
  // A briefing and a permit for hot work (#330).
  personName: 'Name der eingewiesenen Person',
  subject: 'Worin eingewiesen',
  formKey: 'Formular',
  answers: 'Angaben',
  // An article, a supplier, a store and a booking in it (#325).
  designation: 'Bezeichnung',
  ean: 'EAN',
  unit: 'Einheit',
  priceCents: 'Preis',
  customerNumber: 'Kundennummer',
  houseNumber: 'Hausnummer',
  country: 'Land',
  notes: 'Notiz',
  location: 'Wo',
  storeId: 'Lager',
  articleId: 'Artikel',
  minimumMilli: 'Mindestbestand',
  quantityMilli: 'Menge',
  supplierId: 'Lieferant',
  bookedBy: 'Gebucht von',
  bookedAt: 'Gebucht am',
  namesAndTimes: 'Namen und Uhrzeiten auf dem Leistungsnachweis',
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
  // What is said about the template of a round and a version of it (#112).
  // The office keeps both; a device holds them to read.
  sourceKey: 'Übernommen aus dem Paket',
  sourceVersion: 'Fassung im Paket',
  templateId: 'Vorlage',
  formVersion: 'Fassung',
  definition: 'Kapitel und Punkte',
  asksCountersignature: 'Gegenzeichnung verlangt',
  // What is said about a measuring point, a reading, a replacement of its
  // meter and a pause (#119). The office keeps them; a device holds them to
  // read. A pause shares its days and its reason with a closure above.
  conversionFactor: 'Wandlerfaktor',
  mainMeterId: 'Hauptzähler',
  controlId: 'Kennung in der Leittechnik',
  noteBy: 'Notiz von',
  notedOn: 'Notiz seit',
  lockReason: 'Grund der Sperre',
  lockedOn: 'Gesperrt seit',
  keyDate: 'Stichtag',
  // The day of the month of the key date, of the operator or of one measuring
  // point, and the confirmation of a figure that jumps (#120).
  keyDay: 'Tag des Stichtags',
  jumpConfirmed: 'Sprung bestätigt',
  readOn: 'Abgelesen am',
  valueMilli: 'Stand',
  source: 'Weg',
  correctsId: 'Berichtigt',
  correctionReason: 'Grund der Berichtigung',
  recordedBy: 'Eingetragen von',
  exchangedOn: 'Tag des Tauschs',
  oldNumber: 'Alte Zählernummer',
  oldEndMilli: 'Endstand',
  newNumber: 'Neue Zählernummer',
  newStartMilli: 'Anfangsstand',
  // What is said about the plan of a round (#113). The office keeps it; a
  // device holds it to read, and a round names the plan that made it.
  rhythm: 'Rhythmus',
  weekdays: 'Wochentage',
  dayOfMonth: 'Tag',
  month: 'Monat',
  leadDays: 'Vorlauf',
  showsFromDay: 'Sichtbar ab',
  showsFromMonth: 'Sichtbar ab, Monat',
  resting: 'Ruht',
  skipHolidays: 'Gesetzliche Feiertage auslassen',
}
