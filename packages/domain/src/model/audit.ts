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
      },
    },
    buildings: {
      label: 'Gebäude',
      fields: { short_code: 'Kürzel', kinds: 'Gebäudearten', year_built: 'Baujahr' },
    },
    floors: { label: 'Geschoss', fields: { level: 'Ebene' } },
    rooms: {
      label: 'Raum',
      fields: { floor_id: 'Geschoss', number: 'Raumnummer', use: 'Nutzung' },
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
      },
    },
  },
  // The deadlines are a table of the foundation (opengewerk-haustechnik#24);
  // what a deadline of this application hangs on is this application's own.
  ownFields: {
    deadlines: {
      duty_id: 'Pflicht',
      property_id: 'Liegenschaft',
      area_id: 'Bereich',
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
    reasons: {
      'session.switch': 'Wechsel zu einem anderen Betreiber',
      'operator.appoint': 'Zur Verwaltung der Instanz benennen',
      'operator.remove': 'Aus der Verwaltung der Instanz entfernen',
      'operator.cli': 'Verwaltung der Instanz über die Kommandozeile',
      'instance.tenant': 'Betreiber für andere anlegen',
      'tenant.cli': 'Betreiber über die Kommandozeile',
    },
  },
  parts: {},
  records: [],
  references: {
    area_id: 'areas',
    property_id: 'properties',
    building_id: 'buildings',
    floor_id: 'floors',
    room_id: 'rooms',
    asset_id: 'assets',
    parent_asset_id: 'assets',
    duty_id: 'duties',
  },
  personFields: [
    'substitute_user_id',
    'absent_user_id',
    'responsible_user_id',
    'confirmed_by',
    'dismissed_by',
  ],
  // Rows without a name of their own are named after the person they are
  // about, and a substitution after the person whose areas it takes over.
  titles: {
    member_all_areas: ['user_id'],
    member_areas: ['user_id'],
    substitutions: ['absent_user_id'],
    // A room by its number, and by its name where it has none.
    rooms: ['number', 'name'],
    // An entry of a life cycle by its state, a supply by what is supplied.
    asset_lifecycle: ['state'],
    asset_supplies: ['building_id', 'room_id'],
    // A duty of the operator's own by its name, one from the catalogue by its
    // kind; a dismissal by the kind it dismissed.
    duties: ['label', 'kind'],
    duty_dismissals: ['kind'],
    // An evidence by the day it was done on.
    evidence: ['performed_on'],
  },
  reasons: {},
  rights: rightLabel,
  roles: Object.fromEntries(shippedRoles.map((role) => [role.key, role.label])),
}
