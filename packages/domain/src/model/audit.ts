import {
  type AuditVocabulary,
  checkPointResultLabel,
  ruleScopeNames,
} from '@opengewerk/platform-domain'

import {
  activityKindLabel,
  activityStatusLabel,
  workOrderKindLabel,
  workOrderUrgencyLabel,
} from './activity.js'
import { lifecycleStateLabel } from './asset.js'
import { countingLabel, dutyTaskLabel } from './catalogue.js'
import { defectStatusLabel } from './defect.js'
import { documentKindLabel } from './document.js'
import { dutyBasisLabel, dutyPerformerLabel } from './duty-record.js'
import { evidenceOriginLabel, evidenceResultLabel } from './evidence.js'
import { meterUnitSymbol } from './meter.js'
import { meterReadingSourceLabel } from './meter-reading.js'
import { numberRangeLabel } from './number-range.js'
import { planRhythmLabel } from './round-plan.js'
import { signatureRoleLabel, workOrderDecisionLabel } from './signature.js'

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
    // What a measuring point holds beside its asset (#119).
    meter_points: {
      label: 'Messstelle',
      fields: {
        conversion_factor: 'Wandlerfaktor',
        main_meter_id: 'Hauptzähler',
        control_id: 'Kennung in der Leittechnik',
        key_day: 'Tag des Stichtags',
        note: 'Notiz',
        note_by: 'Notiz von',
        noted_on: 'Notiz seit',
        lock_reason: 'Grund der Sperre',
        locked_on: 'Gesperrt seit',
      },
    },
    meter_readings: {
      label: 'Zählerstand',
      fields: {
        key_date: 'Stichtag',
        read_on: 'Abgelesen am',
        value_milli: 'Stand in Tausendsteln',
        source: 'Weg',
        activity_id: 'Vorgang',
        corrects_id: 'Berichtigt',
        correction_reason: 'Grund der Berichtigung',
        jump_confirmed: 'Sprung bestätigt',
        recorded_by: 'Eingetragen von',
      },
    },
    meter_exchanges: {
      label: 'Zählertausch',
      fields: {
        exchanged_on: 'Tag des Tauschs',
        old_number: 'Alte Zählernummer',
        old_end_milli: 'Endstand in Tausendsteln',
        new_number: 'Neue Zählernummer',
        new_start_milli: 'Anfangsstand in Tausendsteln',
      },
    },
    meter_pauses: {
      label: 'Stilllegung',
      fields: { starts_on: 'Von', ends_on: 'Bis', reason: 'Grund' },
    },
    // The day of the month the readings of the operator are due on (#120).
    meter_settings: { label: 'Stichtag der Zähler', fields: { key_day: 'Tag des Stichtags' } },
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
        task: 'Tätigkeit',
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
    // The frozen state of a round as a whole (#111).
    round_records: {
      label: 'Eingefrorener Stand eines Rundgangs',
      fields: {
        activity_id: 'Rundgang',
        state: 'Eingefrorener Stand',
        fingerprint: 'Fingerabdruck',
      },
    },
    // The PDF made of a frozen state (#111).
    prints: {
      label: 'PDF eines eingefrorenen Stands',
      fields: {
        evidence_id: 'Nachweis',
        activity_id: 'Rundgang',
        voided: 'Mit der Ungültigerklärung',
        sha256: 'Datei',
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
        performer: 'Durchführung',
        performer_user_id: 'Ausgeführt von',
        contractor_note: 'Fremdfirma',
        closing_reason: 'Grund',
        performed_on: 'Durchgeführt am',
        countersignature_required: 'Gegenzeichnung verlangt',
        form_key: 'Formular',
        form_version: 'Fassung des Formulars',
        template_on: 'Vorlage vom',
        round_plan_id: 'Plan',
      },
    },
    // The answer to a point of the form of an activity (#106).
    activity_answers: {
      label: 'Antwort',
      fields: {
        activity_id: 'Vorgang',
        group_key: 'Gruppe',
        block_key: 'Block',
        field_key: 'Punkt',
        value: 'Wert',
        result: 'Ergebnis',
        remark: 'Bemerkung',
        attachment_id: 'Foto',
      },
    },
    // The template of a round and its versions (#112). A version is never
    // changed, so its log is the line that says who saved it and when.
    round_templates: {
      label: 'Vorlage eines Rundgangs',
      fields: {
        title: 'Bezeichnung',
        source_key: 'Übernommen aus dem Paket',
        source_version: 'Fassung im Paket',
      },
    },
    round_template_versions: {
      label: 'Fassung einer Vorlage',
      fields: {
        template_id: 'Vorlage',
        form_version: 'Fassung',
        definition: 'Kapitel und Punkte',
        asks_countersignature: 'Gegenzeichnung verlangt',
      },
    },
    // The plan of a round (#113): which template is walked where, how often
    // and for whom.
    round_plans: {
      label: 'Plan eines Rundgangs',
      fields: {
        template_id: 'Vorlage',
        rhythm: 'Rhythmus',
        weekdays: 'Wochentage',
        day_of_month: 'Tag',
        month: 'Monat',
        lead_days: 'Vorlauf',
        starts_on: 'Ab',
        ends_on: 'Bis',
        resting: 'Ruht',
        performer_user_id: 'Zuständig',
      },
    },
    activity_duties: {
      label: 'Pflicht eines Vorgangs',
      fields: {
        activity_id: 'Vorgang',
        duty_id: 'Pflicht',
        result: 'Ergebnis',
        result_reason: 'Grund',
        remark: 'Bemerkung',
      },
    },
    work_orders: {
      label: 'Arbeitsauftrag',
      fields: {
        activity_id: 'Vorgang',
        activity_kind: 'Art des Vorgangs',
        number: 'Auftragsnummer',
        kind: 'Art des Auftrags',
        urgency: 'Dringlichkeit',
        origin_defect_id: 'Aus dem Mangel',
        duration_minutes: 'Dauer in Minuten',
      },
    },
    // A note on a work order (#118).
    work_order_notes: {
      label: 'Notiz zu einem Auftrag',
      fields: {
        activity_id: 'Vorgang',
        activity_kind: 'Art des Vorgangs',
        text: 'Text',
        written_at: 'Geschrieben am',
        written_by: 'Geschrieben von',
      },
    },
    // The further people of a work order (#73).
    work_order_participants: {
      label: 'Beteiligte Person',
      fields: {
        activity_id: 'Vorgang',
        activity_kind: 'Art des Vorgangs',
        user_id: 'Person',
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
        found_in_evidence_id: 'Genannt im Nachweis',
        found_in_answer_id: 'Aus der Antwort',
        remedy_work_order_id: 'Beseitigt mit',
        description: 'Beschreibung',
        defect_class: 'Klasse',
        found_on: 'Festgestellt am',
        due_on: 'Zu beseitigen bis',
        status: 'Stand',
        checked_on: 'Nachgeprüft am',
        check_note: 'Bemerkung zur Nachprüfung',
      },
    },
    // The default of a class of defects, which the operator sets (#116).
    defect_class_terms: {
      label: 'Vorgabe einer Mängelklasse',
      fields: { defect_class: 'Klasse', due_days: 'Tage bis zur Beseitigung' },
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
      defect_id: 'Mangel',
      round_plan_id: 'Plan eines Rundgangs',
      meter_property_id: 'Zähler der Liegenschaft',
      property_id: 'Liegenschaft',
      area_id: 'Bereich',
    },
    attachments: {
      activity_id: 'Vorgang',
      defect_id: 'Mangel',
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
      // What a measuring point holds beside its asset (#119).
      { table: 'meter_points', column: 'asset_id' },
      { table: 'meter_readings', column: 'asset_id' },
      { table: 'meter_exchanges', column: 'asset_id' },
      { table: 'meter_pauses', column: 'asset_id' },
    ],
    // A document with its versions: who filed which, and when.
    attachments: [{ table: 'attachment_versions', column: 'attachment_id' }],
    // An activity with the duties it is to meet and what came of each, the
    // answers to the points of its form, and for a work order what only it
    // has, the further people working on it and the notes written on it.
    activities: [
      { table: 'activity_duties', column: 'activity_id' },
      { table: 'activity_answers', column: 'activity_id' },
      { table: 'work_orders', column: 'activity_id' },
      { table: 'work_order_participants', column: 'activity_id' },
      { table: 'work_order_notes', column: 'activity_id' },
    ],
    // A defect with its photos.
    defects: [{ table: 'attachments', column: 'defect_id' }],
    // A template with its versions: who saved which, and when.
    round_templates: [{ table: 'round_template_versions', column: 'template_id' }],
  },
  // The records the log is opened from, each from the screen that shows it.
  records: [
    'properties',
    'buildings',
    'floors',
    'rooms',
    'assets',
    'duties',
    'attachments',
    'activities',
    'defects',
    'round_templates',
    'round_plans',
  ],
  references: {
    area_id: 'areas',
    property_id: 'properties',
    building_id: 'buildings',
    floor_id: 'floors',
    room_id: 'rooms',
    asset_id: 'assets',
    parent_asset_id: 'assets',
    main_meter_id: 'assets',
    corrects_id: 'meter_readings',
    duty_id: 'duties',
    activity_id: 'activities',
    found_in_activity_id: 'activities',
    found_in_evidence_id: 'evidence',
    remedy_work_order_id: 'work_orders',
    origin_defect_id: 'defects',
    defect_id: 'defects',
    work_order_id: 'work_orders',
    evidence_id: 'evidence',
    replaces_evidence_id: 'evidence',
    template_id: 'round_templates',
    round_plan_id: 'round_plans',
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
    'note_by',
    'recorded_by',
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
    // A version of a template by its number, a plan by the template it walks.
    round_template_versions: ['form_version'],
    round_plans: ['template_id'],
    // A room by its number, and by its name where it has none.
    rooms: ['number', 'name'],
    // An import by its file.
    imports: ['file_name'],
    // A label by its code, which is what stands on the sticker.
    labels: ['code'],
    // An entry of a life cycle by its state, a supply by what is supplied.
    asset_lifecycle: ['state'],
    asset_supplies: ['building_id', 'room_id'],
    // What a measuring point holds by its asset, a reading by its key date, a
    // replacement by its day, a pause by its first day.
    meter_points: ['asset_id'],
    meter_readings: ['key_date'],
    meter_exchanges: ['exchanged_on'],
    meter_pauses: ['starts_on'],
    meter_settings: ['key_day'],
    // A duty of the operator's own by its name, one from the catalogue by its
    // kind; a dismissal by the kind it dismissed.
    duties: ['label', 'kind'],
    duty_dismissals: ['kind'],
    // An evidence by its number, and a declaration of invalidity by its evidence.
    evidence: ['number'],
    evidence_voidings: ['evidence_id'],
    // The frozen state of a round by its round.
    round_records: ['activity_id'],
    // A PDF by what it was made of.
    prints: ['evidence_id', 'activity_id'],
    // An activity by its name, the duty of an activity by the duty, an answer
    // by its point, a work order by its number and a defect by what was
    // noticed.
    activities: ['title'],
    activity_duties: ['duty_id'],
    activity_answers: ['field_key'],
    work_orders: ['number'],
    // A further person by who it is.
    work_order_participants: ['user_id'],
    // A note by what it says.
    work_order_notes: ['text'],
    defects: ['description'],
    defect_class_terms: ['defect_class'],
    // A signature by who gave it, a decision by what it decided.
    activity_signatures: ['signed_by'],
    work_order_decisions: ['decision'],
  },
  reasons: {},
  rights: rightLabel,
  roles: Object.fromEntries(shippedRoles.map((role) => [role.key, role.label])),
}

/**
 * How the values of a list are written in the change log (#80): the log
 * holds `with_defects`, the Leitung reads "Mit Mängeln". By table and column
 * of the database, as the log names them; a test holds every column the
 * triggers watch whose type is a list against it.
 */
export const auditValues: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = {
  activities: {
    kind: activityKindLabel,
    performer: dutyPerformerLabel,
    status: activityStatusLabel,
  },
  activity_answers: { result: checkPointResultLabel },
  activity_duties: { result: evidenceResultLabel },
  activity_signatures: { role: signatureRoleLabel },
  asset_lifecycle: { state: lifecycleStateLabel },
  assets: { meter_unit: meterUnitSymbol },
  attachments: { kind: documentKindLabel },
  // The deadlines of the foundation, in the words of its list of deadlines.
  deadlines: { status: { open: 'Offen', done: 'Erledigt', dropped: 'Entfallen' } },
  defects: { status: defectStatusLabel },
  duties: {
    basis: dutyBasisLabel,
    counting: countingLabel,
    performer: dutyPerformerLabel,
    task: dutyTaskLabel,
  },
  evidence: { origin: evidenceOriginLabel, result: evidenceResultLabel },
  mail_settings: { security: { starttls: 'STARTTLS', tls: 'TLS', none: 'Ohne Verschlüsselung' } },
  meter_readings: { source: meterReadingSourceLabel },
  // A number range by what it counts, not by its key (#176).
  number_ranges: { key: numberRangeLabel },
  // The log holds `DE-BW`, the Leitung reads "Baden-Württemberg".
  properties: { federal_state: ruleScopeNames },
  round_plans: { rhythm: planRhythmLabel },
  work_order_decisions: { decision: workOrderDecisionLabel },
  work_order_notes: { activity_kind: activityKindLabel },
  work_order_participants: { activity_kind: activityKindLabel },
  work_orders: {
    activity_kind: activityKindLabel,
    kind: workOrderKindLabel,
    urgency: workOrderUrgencyLabel,
  },
}
