import type { AuditVocabulary } from '@opengewerk/platform-domain'

import { rightLabel, shippedRoles } from './rights.js'

/**
 * The change log of a tenant in the words of this application (Abschnitt 3 of
 * the concept: "Änderungsprotokoll über alle Module, für die Leitung
 * einsehbar"). The foundation reads the log, holds the rules and names its
 * own tables, those of tenants, accounts, roles and the instance (ADR 0010 in
 * the repository opengewerk); this is what it is told, as one value.
 *
 * Each table this application adds gets its words here, and the server's test
 * against the catalogue fails until it has them.
 */
export const auditVocabulary: AuditVocabulary = {
  tables: {
    // The areas of a tenant, who sees which, and who stands in for whom
    // (ADR 0003). Who sees every area is a row of its own and no column on the
    // membership, because the membership is a table of the foundation.
    areas: { label: 'Bereich' },
    member_all_areas: { label: 'Alle Bereiche' },
    member_areas: { label: 'Bereich einer Person' },
    // What an invitation says about the areas of whoever takes it up (#84).
    invitation_area_choices: {
      label: 'Bereiche einer Einladung',
      fields: { invitation_id: 'Einladung', every_area: 'Alle Bereiche' },
    },
    invitation_areas: {
      label: 'Bereich einer Einladung',
      fields: { invitation_id: 'Einladung' },
    },
    substitutions: {
      label: 'Vertretung',
      fields: {
        substitute_user_id: 'Vertreten durch',
        absent_user_id: 'Vertretene Person',
        starts_on: 'Von',
        ends_on: 'Bis',
      },
    },
    // The place (ADR 0002).
    properties: {
      label: 'Liegenschaft',
      fields: {
        street: 'Straße',
        postal_code: 'Postleitzahl',
        city: 'Ort',
        federal_state: 'Bundesland',
        note: 'Notiz',
      },
    },
    buildings: {
      label: 'Gebäude',
      fields: { short_code: 'Kürzel', kinds: 'Gebäudearten', year_built: 'Baujahr' },
    },
    floors: { label: 'Geschoss', fields: { level: 'Ebene' } },
    // The times a building is closed (#86): in which no round is made for it.
    building_closures: {
      label: 'Schließzeit',
      fields: { starts_on: 'Von', ends_on: 'Bis', reason: 'Anlass' },
    },
    rooms: {
      label: 'Raum',
      fields: { floor_id: 'Geschoss', number: 'Raumnummer', use: 'Nutzung' },
    },
    // An import from a table (#100): one row for the whole of it, which is
    // what the log shows in the place of every record it made. And what the
    // lists of the tenant call an asset kind.
    imports: {
      label: 'Import',
      fields: {
        kind: 'Übernommen wurden',
        file_name: 'Datei',
        lines: 'Zeilen',
        summary: 'Ergebnis',
      },
    },
    asset_kind_names: {
      label: 'Bezeichnung einer Anlagenart',
      fields: { name_key: 'Verglichen als', kind: 'Anlagenart' },
    },
    // The technology (ADR 0002, points 4 to 9).
    assets: {
      label: 'Anlage',
      fields: {
        parent_asset_id: 'Gehört zu',
        kind: 'Anlagenart',
        number: 'Anlagennummer',
        mark: 'Kennzeichen',
        manufacturer: 'Hersteller',
        model: 'Typ',
        serial_number: 'Seriennummer',
        year_built: 'Baujahr',
        commissioned_on: 'Inbetriebnahme',
        warranty_ends_on: 'Ende der Gewährleistung',
        values: 'Angaben der Anlagenart',
        meter_number: 'Zählernummer',
        meter_unit: 'Einheit des Zählers',
        distinct_from: 'Für eine andere befunden als',
      },
    },
    asset_lifecycle: {
      label: 'Lebenszyklus',
      fields: { state: 'Zustand', valid_from: 'Ab' },
    },
    asset_supplies: { label: 'Versorgt' },
    // The duties of an operator and the proposals dismissed (ADR 0002, points
    // 10 and 11).
    duties: {
      label: 'Pflicht',
      fields: {
        kind: 'Pflichtart',
        kind_version: 'Fassung der Pflichtart',
        label: 'Bezeichnung',
        basis: 'Grundlage',
        source_note: 'Quelle',
        counting: 'Zählweise',
        interval_days: 'Frist in Tagen',
        interval_months: 'Frist in Monaten',
        interval_reason: 'Begründung der Frist',
        maximum_days: 'Höchstfrist in Tagen',
        maximum_months: 'Höchstfrist in Monaten',
        responsible_user_id: 'Verantwortlich',
        performer: 'Ausgeführt von',
        performer_note: 'Fremdfirma',
        confirmed_by: 'Bestätigt von',
        confirmed_at: 'Bestätigt am',
        ends_on: 'Endet am',
        end_reason: 'Grund für das Ende',
      },
    },
    duty_dismissals: {
      label: 'Verworfener Vorschlag',
      fields: {
        kind: 'Pflichtart',
        kind_version: 'Fassung der Pflichtart',
        reason: 'Begründung',
        dismissed_by: 'Verworfen von',
      },
    },
    evidence: {
      label: 'Nachweis',
      fields: {
        duty_id: 'Pflicht',
        performed_on: 'Durchgeführt am',
        result: 'Ergebnis',
        result_reason: 'Grund',
        number: 'Nachweisnummer',
        origin: 'Herkunft',
        activity_id: 'Vorgang',
        performed_by: 'Durchgeführt von',
        examiner: 'Prüfer',
        examiner_organisation: 'Organisation des Prüfers',
        written_by: 'Festgeschrieben von',
        written_at: 'Festgeschrieben am',
        replaces_evidence_id: 'Berichtigt den Nachweis',
        replacement_reason: 'Grund der Berichtigung',
        state: 'Eingefrorener Stand',
        fingerprint: 'Fingerabdruck',
      },
    },
    // An evidence declared invalid (ADR 0004, point 15).
    evidence_voidings: {
      label: 'Ungültigerklärung eines Nachweises',
      fields: {
        evidence_id: 'Nachweis',
        reason: 'Grund',
        voided_by: 'Für ungültig erklärt von',
        voided_at: 'Für ungültig erklärt am',
      },
    },
    // The activities with the duties they meet and their work orders, and the
    // defects (ADR 0002, points 13 and 15).
    activities: {
      label: 'Vorgang',
      fields: {
        kind: 'Art',
        title: 'Bezeichnung',
        status: 'Stand',
        due_on: 'Fällig am',
        responsible_user_id: 'Verantwortlich',
        performer_user_id: 'Ausgeführt von',
        contractor_note: 'Fremdfirma',
        closing_reason: 'Grund',
        performed_on: 'Durchgeführt am',
        countersignature_required: 'Gegenzeichnung verlangt',
      },
    },
    activity_duties: {
      label: 'Pflicht eines Vorgangs',
      fields: {
        activity_id: 'Vorgang',
        duty_id: 'Pflicht',
        result: 'Ergebnis',
        result_reason: 'Grund',
      },
    },
    work_orders: {
      label: 'Arbeitsauftrag',
      fields: {
        activity_id: 'Vorgang',
        activity_kind: 'Art des Vorgangs',
        number: 'Auftragsnummer',
        kind: 'Art des Auftrags',
      },
    },
    // A signature on an activity and the decision on a work order (ADR 0004,
    // points 7 and 8).
    activity_signatures: {
      label: 'Unterschrift',
      fields: {
        activity_id: 'Vorgang',
        signed_by: 'Unterschrieben von',
        role: 'Als',
        signed_at: 'Unterschrieben am',
        device_info: 'Gerät',
        path: 'Linienzug',
        page_fingerprint: 'Fingerabdruck der Seite',
      },
    },
    work_order_decisions: {
      label: 'Abnahme eines Auftrags',
      fields: {
        work_order_id: 'Arbeitsauftrag',
        decision: 'Entscheidung',
        reason: 'Grund',
        decided_by: 'Entschieden von',
        decided_at: 'Entschieden am',
      },
    },
    // The labels with a QR code on assets and rooms (#98). What a label hangs
    // on is named below with the fields every row with a place has.
    labels: {
      label: 'Etikett',
      fields: { code: 'Code', blocked_at: 'Gesperrt am' },
    },
    defects: {
      label: 'Mangel',
      fields: {
        found_in_activity_id: 'Festgestellt bei',
        remedy_work_order_id: 'Beseitigt mit',
        description: 'Beschreibung',
        defect_class: 'Klasse',
        found_on: 'Festgestellt am',
        due_on: 'Zu beseitigen bis',
        status: 'Stand',
      },
    },
  },
  // The deadlines are a table of the foundation (opengewerk-haustechnik#24);
  // what a deadline of this application hangs on is this application's own.
  // The contacts are one as well (#85), and need no entry here: a contact
  // hangs on its property and lies in its area, and both are named below with
  // the fields every row with a place has.
  // The documents are two more (#97): the property, the area and the place a
  // document hangs on are named below like those of every row with a place,
  // and what remains its own is the activity and its kind.
  ownFields: {
    deadlines: {
      duty_id: 'Pflicht',
      property_id: 'Liegenschaft',
      area_id: 'Bereich',
    },
    attachments: {
      activity_id: 'Vorgang',
      kind: 'Art',
    },
  },
  // Every row with a place carries its area and the levels above it (ADR 0002,
  // point 2, and ADR 0003, point 4).
  commonFields: {
    area_id: 'Bereich',
    property_id: 'Liegenschaft',
    building_id: 'Gebäude',
    room_id: 'Raum',
    asset_id: 'Anlage',
  },
  // A tenant is a "Betreiber", whoever leads one its "Leitung", and whoever
  // runs the instance the "Verwaltung der Instanz" (ADR 0001, point 11).
  foundation: {
    tenant: 'Betreiber',
    tenantParameter: 'Einstellung des Betreibers',
    leads: 'Leitet den Betreiber',
    operator: 'Verwaltung der Instanz',
    // A file in the records is a document here (section 4.10 of the concept).
    attachments: { record: 'Dokument', version: 'Fassung eines Dokuments' },
    reasons: {
      'session.switch': 'Wechsel zu einem anderen Betreiber',
      'operator.appoint': 'Zur Verwaltung der Instanz benennen',
      'operator.remove': 'Aus der Verwaltung der Instanz entfernen',
      'operator.cli': 'Verwaltung der Instanz über die Kommandozeile',
      'instance.tenant': 'Betreiber für andere anlegen',
      'tenant.cli': 'Betreiber über die Kommandozeile',
    },
  },
  // What the log of a record takes in beside the record itself: the rows the
  // office sees and changes on the same screen. A property with the people to
  // talk to there, a building with the times it is closed, an asset with its
  // life cycle, what it supplies and its labels, a room with its labels. The buildings of a
  // property, their floors and the rooms on a floor are records of their own,
  // each with a page and a log of its own.
  parts: {
    properties: [{ table: 'contacts', column: 'property_id' }],
    buildings: [{ table: 'building_closures', column: 'building_id' }],
    rooms: [{ table: 'labels', column: 'room_id' }],
    assets: [
      { table: 'asset_lifecycle', column: 'asset_id' },
      { table: 'asset_supplies', column: 'asset_id' },
      { table: 'labels', column: 'asset_id' },
    ],
    // A document with its versions: who filed which, and when.
    attachments: [{ table: 'attachment_versions', column: 'attachment_id' }],
  },
  // The records the log is opened from, each from the screen that shows it.
  records: ['properties', 'buildings', 'floors', 'rooms', 'assets', 'duties', 'attachments'],
  references: {
    area_id: 'areas',
    property_id: 'properties',
    building_id: 'buildings',
    floor_id: 'floors',
    room_id: 'rooms',
    asset_id: 'assets',
    parent_asset_id: 'assets',
    duty_id: 'duties',
    activity_id: 'activities',
    found_in_activity_id: 'activities',
    remedy_work_order_id: 'work_orders',
    work_order_id: 'work_orders',
    evidence_id: 'evidence',
    replaces_evidence_id: 'evidence',
  },
  personFields: [
    'substitute_user_id',
    'absent_user_id',
    'responsible_user_id',
    'performer_user_id',
    'performed_by',
    'written_by',
    'signed_by',
    'decided_by',
    'voided_by',
    'confirmed_by',
    'dismissed_by',
  ],
  // Rows without a name of their own are named after the person they are
  // about, and a substitution after the person whose areas it takes over.
  titles: {
    member_all_areas: ['user_id'],
    member_areas: ['user_id'],
    // What an invitation says about areas is named after the invitation.
    invitation_area_choices: ['invitation_id'],
    invitation_areas: ['invitation_id'],
    substitutions: ['absent_user_id'],
    // A closure by what it is for, and by its first day where it says nothing.
    building_closures: ['reason', 'starts_on'],
    // A room by its number, and by its name where it has none.
    rooms: ['number', 'name'],
    // An import by its file.
    imports: ['file_name'],
    // A label by its code, which is what stands on the sticker.
    labels: ['code'],
    // An entry of a life cycle by its state, a supply by what is supplied.
    asset_lifecycle: ['state'],
    asset_supplies: ['building_id', 'room_id'],
    // A duty of the operator's own by its name, one from the catalogue by its
    // kind; a dismissal by the kind it dismissed.
    duties: ['label', 'kind'],
    duty_dismissals: ['kind'],
    // An evidence by its number, and a declaration of invalidity by its evidence.
    evidence: ['number'],
    evidence_voidings: ['evidence_id'],
    // An activity by its name, the duty of an activity by the duty, a work
    // order by its number and a defect by what was noticed.
    activities: ['title'],
    activity_duties: ['duty_id'],
    work_orders: ['number'],
    defects: ['description'],
    // A signature by who gave it, a decision by what it decided.
    activity_signatures: ['signed_by'],
    work_order_decisions: ['decision'],
  },
  reasons: {},
  rights: rightLabel,
  roles: Object.fromEntries(shippedRoles.map((role) => [role.key, role.label])),
}
