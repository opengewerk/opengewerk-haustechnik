import {
  type AuditFormat,
  type AuditTableWords,
  type AuditVocabulary,
  cableInstallationMethodName,
  checkPointResultLabel,
  deadlineReminderLabel,
  distributionBoardKindLabel,
  overcurrentDeviceName,
  rcdTypeLabel,
  tripCharacteristicLabel,
  ruleScopeNames,
  stockMovementKindLabel,
  stockUnitLabel,
  personLevelLabel,
  structureAuditParts,
  structureAuditReferences,
  structureAuditTables,
  structureAuditTitles,
} from '@opengewerk/platform-domain'

import {
  activityKindLabel,
  activityStatusLabel,
  workOrderKindLabel,
  basicMeasureLabel,
  workOrderUrgencyLabel,
} from './activity.js'
import { lifecycleStateLabel } from './asset.js'
import { assetValuesWords } from './asset-value-words.js'
import { buildingKindLabel } from './location.js'
import { type Catalogue, type CatalogueEntry, countingLabel, dutyTaskLabel } from './catalogue.js'
import { noticeUnitLabel } from './contract.js'
import { delegationRoleLabel, delegationScopeLabel } from './delegation.js'
import { defectStatusLabel } from './defect.js'
import { documentKindLabel } from './document.js'
import { dutyBasisLabel, dutyPerformerLabel } from './duty-record.js'
import { evidenceOriginLabel, evidenceResultLabel } from './evidence.js'
import { meterUnitSymbol } from './meter.js'
import { meterReadingSourceLabel } from './meter-reading.js'
import { numberRangeLabel } from './number-range.js'
import { ownFieldSortLabel } from './own-kinds.js'
import { pushOccasionWords } from './push.js'
import { planRhythmLabel, weekdayLabel } from './round-plan.js'
import { templateKeyPrefix } from './round-template.js'
import { signatureRoleLabel, workOrderDecisionLabel } from './signature.js'

import { rightLabel, shippedRoles } from './rights.js'

/**
 * The tables of the structure below an asset this application makes: the
 * electrical one below a low-voltage installation (#349) and the PV one below
 * a PV installation (#461). The foundation names both, and words for a table
 * nobody watches would be left over (`auditVocabularyGaps`).
 */
const structureTables: readonly string[] = [
  'distribution_boards',
  'board_sections',
  'circuits',
  'equipment',
  'inverters',
  'pv_strings',
  'pv_modules',
]

/** What the foundation says about the structure, for the tables this application makes. */
function ofTheStructure<Words>(
  words: Readonly<Record<string, Words>>,
  table: (key: string, value: Words) => string = (key) => key,
): Record<string, Words> {
  return Object.fromEntries(
    Object.entries(words).filter(([key, value]) => structureTables.includes(table(key, value))),
  )
}

/**
 * The fields of the structure the foundation leaves to an application, since
 * it names none that many tables of an application share. The words of the
 * assets where an asset has the same field.
 */
const structureFields: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  distribution_boards: { kind: 'Art', designation: 'Bezeichnung', position: 'Reihenfolge' },
  board_sections: { designation: 'Bezeichnung', position: 'Reihenfolge' },
  circuits: { designation: 'Bezeichnung', position: 'Reihenfolge' },
  equipment: {
    designation: 'Bezeichnung',
    kind: 'Art',
    manufacturer: 'Hersteller',
    model: 'Typ',
    serial_number: 'Seriennummer',
    position: 'Reihenfolge',
  },
  // The PV structure in the words of its forms, which say "Modell" (#461),
  // and where an inverter hangs, which this application asks beside it.
  inverters: {
    designation: 'Bezeichnung',
    location: 'Ort',
    manufacturer: 'Hersteller',
    model: 'Modell',
    serial_number: 'Seriennummer',
    position: 'Reihenfolge',
  },
  pv_strings: { designation: 'Bezeichnung', position: 'Reihenfolge' },
  pv_modules: {
    manufacturer: 'Hersteller',
    model: 'Modell',
    serial_number: 'Seriennummer',
    position: 'Reihenfolge',
  },
}

/** The words of the tables of the structure, the foundation's with the fields above. */
const structureTableWords: Readonly<Record<string, AuditTableWords>> = Object.fromEntries(
  Object.entries(ofTheStructure(structureAuditTables)).map(([table, words]) => [
    table,
    { ...words, fields: { ...structureFields[table], ...words.fields } },
  ]),
)

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
    // What an auditor from outside is limited to beside the areas, and what an invitation limits to (#339).
    member_limit_properties: { label: 'Liegenschaft eines Prüfers' },
    member_limit_asset_kinds: {
      label: 'Anlagenart eines Prüfers',
      fields: { asset_kind: 'Anlagenart' },
    },
    invitation_limit_properties: {
      label: 'Liegenschaft einer Einladung',
      fields: { invitation_id: 'Einladung' },
    },
    invitation_limit_asset_kinds: {
      label: 'Anlagenart einer Einladung',
      fields: { invitation_id: 'Einladung', asset_kind: 'Anlagenart' },
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
      fields: {
        short_code: 'Kürzel',
        kinds: 'Gebäudearten',
        year_built: 'Baujahr',
        // A building with an area of its own (#306).
        own_area_id: 'Eigener Bereich',
      },
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
    // The asset kinds and fields of the operator's own (#62).
    own_asset_kinds: {
      label: 'Eigene Anlagenart',
      fields: {
        key: 'Schlüssel',
        label: 'Bezeichnung',
        cost_group: 'Kostengruppe',
        expected_documents: 'Unterlagen',
        revision: 'Fassung',
      },
    },
    own_asset_fields: {
      label: 'Eigene Angabe',
      fields: {
        asset_kind: 'Anlagenart',
        key: 'Schlüssel',
        label: 'Bezeichnung',
        sort: 'Sorte',
        unit: 'Einheit',
        options: 'Auswahl',
        position: 'Stelle',
      },
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
        distinct_from: 'Keine Dublette von',
        replaces_asset_id: 'Ersetzt',
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
    // The electrical structure below a low-voltage installation, in the
    // foundation's words (#349, ADR 0014 in the repository opengewerk). The
    // asset, its property and its area are named with every row with a place.
    // The PV structure below a PV installation the same way (#461).
    ...structureTableWords,
    // The stores of the operator, on the building block of the foundation (#325).
    articles: {
      label: 'Artikel',
      fields: {
        number: 'Nummer',
        designation: 'Bezeichnung',
        description: 'Beschreibung',
        ean: 'EAN',
        unit: 'Einheit',
        price_cents: 'Preis in Cent',
      },
    },
    suppliers: {
      label: 'Lieferant',
      fields: {
        name: 'Name',
        customer_number: 'Kundennummer',
        email: 'E-Mail',
        phone: 'Telefon',
        street: 'Straße',
        house_number: 'Hausnummer',
        postal_code: 'Postleitzahl',
        city: 'Ort',
        country: 'Land',
        notes: 'Notiz',
      },
    },
    stores: { label: 'Lager', fields: { name: 'Name', location: 'Wo' } },
    store_articles: {
      label: 'Artikel eines Lagers',
      fields: {
        store_id: 'Lager',
        article_id: 'Artikel',
        bin: 'Lagerplatz',
        minimum_milli: 'Mindestbestand in Tausendsteln',
      },
    },
    stock_movements: {
      label: 'Buchung im Lager',
      fields: {
        store_id: 'Lager',
        article_id: 'Artikel',
        kind: 'Art',
        quantity_milli: 'Menge in Tausendsteln',
        supplier_id: 'Lieferant',
        counterpart_store_id: 'Anderes Lager',
        reason: 'Grund',
        booked_by: 'Gebucht von',
        booked_at: 'Gebucht am',
        material_id: 'Material am Auftrag',
      },
    },
    // Material taken for a work order (#326), and the labels on the shelves.
    work_order_materials: {
      label: 'Material am Auftrag',
      fields: {
        activity_id: 'Vorgang',
        activity_kind: 'Art des Vorgangs',
        store_id: 'Lager',
        article_id: 'Artikel',
        quantity_milli: 'Menge in Tausendsteln',
        taken_at: 'Entnommen am',
        taken_by: 'Entnommen von',
      },
    },
    // The contractors of the operator (#328).
    contractors: {
      label: 'Fremdfirma',
      fields: {
        name: 'Name',
        street: 'Straße',
        postal_code: 'Postleitzahl',
        city: 'Ort',
        phone: 'Telefon',
        email: 'E-Mail',
        services: 'Leistungen',
        note: 'Notiz',
      },
    },
    // The contracts with the contractors (#329), and what each covers.
    contracts: {
      label: 'Vertrag',
      fields: {
        contractor_id: 'Fremdfirma',
        title: 'Bezeichnung',
        starts_on: 'Beginn',
        ends_on: 'Ende der Laufzeit',
        renewal_months: 'Verlängerung in Monaten',
        notice_amount: 'Kündigungsfrist',
        notice_unit: 'Einheit der Kündigungsfrist',
        cancelled_to: 'Gekündigt zum',
        response_time: 'Reaktionszeit',
        price: 'Preis',
        note: 'Notiz',
      },
    },
    contract_items: {
      label: 'Von einem Vertrag erfasst',
      fields: { contract_id: 'Vertrag', building_id: 'Gebäude', asset_id: 'Anlage' },
    },
    // The delegations of the operator's duties (#336), their areas, the two signatures and a revocation.
    duty_delegations: {
      label: 'Pflichtenübertragung',
      fields: {
        delegate_user_id: 'Beauftragte Person',
        delegate_name: 'Name der beauftragten Person',
        scope: 'Umfang',
        packages: 'Pakete',
        cost_groups: 'Kostengruppen',
        tasks: 'Aufgaben',
        powers: 'Befugnisse',
        starts_on: 'Beginn',
        ends_on: 'Ende',
      },
    },
    duty_delegation_areas: {
      label: 'Bereich einer Pflichtenübertragung',
      fields: { delegation_id: 'Pflichtenübertragung', area_id: 'Bereich' },
    },
    duty_delegation_signatures: {
      label: 'Unterschrift unter einer Pflichtenübertragung',
      fields: {
        delegation_id: 'Pflichtenübertragung',
        role: 'Unterschrieben als',
        signed_by: 'Unterschrieben von',
        signed_at: 'Unterschrieben am',
        path: 'Schriftzug',
        typed_name: 'Getippter Name',
        page_fingerprint: 'Fingerabdruck der Seite',
      },
    },
    duty_delegation_revocations: {
      label: 'Widerruf einer Pflichtenübertragung',
      fields: {
        delegation_id: 'Pflichtenübertragung',
        effective_on: 'Endet am',
        reason: 'Grund',
        revoked_by: 'Widerrufen von',
        revoked_at: 'Widerrufen am',
      },
    },
    // The kinds the operator adds and the qualifications of the people (#337).
    qualification_kinds: {
      label: 'Eigene Art der Qualifikation',
      fields: { label: 'Bezeichnung', level: 'Stufe' },
    },
    qualifications: {
      label: 'Qualifikation',
      fields: {
        user_id: 'Person',
        kind_key: 'Art',
        own_kind_id: 'Eigene Art',
        valid_until: 'Gültig bis',
        note: 'Notiz',
        certificate_sha256: 'Nachweis',
      },
    },
    store_labels: {
      label: 'Etikett eines Lagerfachs',
      fields: { store_article_id: 'Artikel eines Lagers', code: 'Code', blocked_at: 'Gesperrt am' },
    },
    // Whether the service report names the people who did the work (#324).
    work_order_settings: {
      label: 'Einstellungen der Aufträge',
      fields: { names_and_times: 'Namen und Uhrzeiten auf dem Leistungsnachweis' },
    },
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
        // A duty that falls due once (#439).
        due_on: 'Termin',
        counted_from: 'Gezählt ab',
        interval_days: 'Frist in Tagen',
        interval_months: 'Frist in Monaten',
        interval_reason: 'Begründung der Frist',
        interval_document_id: 'Dokument, das die Frist trägt',
        interval_document_version_id: 'Fassung dieses Dokuments',
        maximum_days: 'Höchstfrist in Tagen',
        maximum_months: 'Höchstfrist in Monaten',
        guide_days: 'Richtwert in Tagen',
        guide_months: 'Richtwert in Monaten',
        kept_version: 'So gelassen gegenüber Fassung',
        kept_days: 'So gelassen gegenüber einer Frist der Vorschrift in Tagen',
        kept_months: 'So gelassen gegenüber einer Frist der Vorschrift in Monaten',
        kept_reason: 'Begründung, die Pflicht so zu lassen',
        responsible_user_id: 'Verantwortlich',
        // Where who answers for it comes from (#336).
        responsible_delegation_id: 'Verantwortlich aus der Pflichtenübertragung',
        performer: 'Ausgeführt von',
        performer_note: 'Fremdfirma',
        contractor_id: 'Fremdfirma aus der Liste',
        contract_id: 'Vertrag',
        confirmed_by: 'Bestätigt von',
        confirmed_at: 'Bestätigt am',
        ends_on: 'Endet am',
        end_reason: 'Grund für das Ende',
        replaces_duty_id: 'Löst ab',
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
        contractor_id: 'Fremdfirma aus der Liste',
        written_by: 'Festgeschrieben von',
        written_at: 'Festgeschrieben am',
        replaces_evidence_id: 'Berichtigt den Nachweis',
        next_due_on: 'Nächste Fälligkeit laut übernommener Liste',
        replacement_reason: 'Grund der Berichtigung',
        state: 'Eingefrorener Stand',
        fingerprint: 'Fingerabdruck',
        emptied_at: 'Gelöscht nach Ablauf der Aufbewahrung am',
      },
    },
    // The confirmation that an evidence is deleted after the end of its retention (#340).
    evidence_emptyings: {
      label: 'Löschen eines Nachweises nach Ablauf der Aufbewahrung',
      fields: {
        evidence_id: 'Nachweis',
        confirmed_by: 'Bestätigt von',
        confirmed_at: 'Bestätigt am',
        retention: 'Aufbewahrung',
        minimum_years: 'Mindestens aufbewahren, Jahre',
        ended_on: 'Aufbewahrung endete am',
      },
    },
    // The PDF of an evidence with a higher signature, signed outside (#341).
    evidence_signed_prints: {
      label: 'Höher signiertes PDF eines Nachweises',
      fields: {
        evidence_id: 'Nachweis',
        sha256: 'Datei',
        signer: 'Signiert von',
        issuer: 'Zertifikat von',
        signed_at: 'Signiert am',
        valid_from: 'Zertifikat gültig ab',
        valid_to: 'Zertifikat gültig bis',
        stated_level: 'Stufe nach Angabe des Zertifikats',
        filed_by: 'Abgelegt von',
        filed_at: 'Abgelegt am',
      },
    },
    // The longer retention of an operator (#340).
    evidence_retention_settings: {
      label: 'Aufbewahrung der Nachweise',
      fields: { minimum_years: 'Mindestens aufbewahren, Jahre' },
    },
    // What hangs on no evidence and its own retention (#412).
    activity_emptyings: {
      label: 'Löschen eines Vorgangs ohne Nachweis nach Ablauf der Aufbewahrung',
      fields: {
        activity_id: 'Vorgang',
        confirmed_by: 'Bestätigt von',
        confirmed_at: 'Bestätigt am',
        years: 'Aufbewahrung, Jahre',
        ended_on: 'Aufbewahrung endete am',
      },
    },
    defect_emptyings: {
      label: 'Löschen eines Mangels nach Ablauf der Aufbewahrung',
      fields: {
        defect_id: 'Mangel',
        confirmed_by: 'Bestätigt von',
        confirmed_at: 'Bestätigt am',
        years: 'Aufbewahrung, Jahre',
        ended_on: 'Aufbewahrung endete am',
      },
    },
    record_retention_settings: {
      label: 'Aufbewahrung ohne Nachweis',
      fields: {
        activity_years: 'Vorgang ohne Nachweis, Jahre',
        defect_years: 'Mangel nach Beseitigung, Jahre',
        task_years: 'Erledigte Aufgabe, Jahre',
        reading_person_years: 'Person am Zählerstand, Jahre',
        booking_person_years: 'Person an der Buchung im Lager, Jahre',
      },
    },
    retention_removals: {
      label: 'Gelöscht nach Ablauf der Aufbewahrung',
      fields: { kind: 'Art', removed_count: 'Anzahl' },
    },
    // How long the data of an access stays after its last day, and when it went (#356).
    membership_settings: {
      label: 'Frist nach dem Ende eines Zugangs',
      fields: { removal_days: 'Angaben entfernen nach, Tagen' },
    },
    // The documents on data protection the Leitung made, and what it wrote for the record (#358).
    privacy_documents: {
      label: 'Dokument zum Datenschutz',
      fields: {
        kind: 'Art',
        made_by: 'Erzeugt von',
        holds_for: 'Gilt für',
        text: 'Text',
        changed: 'Geändert gegenüber der vorherigen',
      },
    },
    processing_record_settings: {
      label: 'Verzeichnis der Verarbeitungstätigkeiten',
      fields: { controller: 'Verantwortlicher', officer: 'Datenschutzbeauftragter' },
    },
    processing_record_activities: {
      label: 'Tätigkeit im Verzeichnis',
      fields: {
        activity: 'Tätigkeit',
        purpose: 'Zweck',
        legal_basis: 'Rechtsgrundlage',
        recipients: 'Empfänger',
      },
    },
    // A description of the processing the Leitung made (#357).
    processing_descriptions: {
      label: 'Verfahrensbeschreibung',
      fields: {
        made_by: 'Erzeugt von',
        holds_for: 'Gilt für',
        text: 'Text',
        changed: 'Geändert gegenüber der vorherigen',
      },
    },
    membership_removals: {
      label: 'Entfernen der Angaben eines beendeten Zugangs',
      fields: {
        user_id: 'Person',
        removed_at: 'Entfernt am',
        account_removed: 'Auch das Konto, weil es nirgends mehr arbeitet',
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
    // The PDF made of a frozen state (#111), also of a service report (#324).
    prints: {
      label: 'PDF eines eingefrorenen Stands',
      fields: {
        evidence_id: 'Nachweis',
        activity_id: 'Rundgang',
        round_record_id: 'Abgabe des Rundgangs',
        service_report_id: 'Leistungsnachweis',
        voided: 'Mit der Ungültigerklärung',
        sha256: 'Datei',
      },
    },
    // The client's signature under the service report of a work order and
    // its frozen state (#324).
    service_reports: {
      label: 'Leistungsnachweis',
      fields: {
        activity_id: 'Vorgang',
        client_name: 'Name des Auftraggebers',
        path: 'Linienzug',
        signed_by: 'Aufgenommen von',
        signed_at: 'Unterschrieben am',
        device_info: 'Gerät',
        page_fingerprint: 'Fingerabdruck der Seite',
      },
    },
    // A contractor at work (#330): the briefing of one of its people and the
    // permit for hot work, both at a work order.
    briefings: {
      label: 'Einweisung',
      fields: {
        activity_id: 'Vorgang',
        contractor_id: 'Fremdfirma',
        person_name: 'Name der eingewiesenen Person',
        subject: 'Worin eingewiesen',
        path: 'Linienzug',
        signed_by: 'Aufgenommen von',
        signed_at: 'Unterschrieben am',
        device_info: 'Gerät',
      },
    },
    work_permits: {
      label: 'Erlaubnisschein',
      fields: {
        activity_id: 'Vorgang',
        contractor_id: 'Fremdfirma',
        form_key: 'Formular',
        form_version: 'Fassung des Formulars',
        answers: 'Angaben',
        signed_by: 'Ausgestellt von',
        signed_at: 'Ausgestellt am',
        device_info: 'Gerät',
      },
    },
    service_report_records: {
      label: 'Eingefrorener Stand eines Leistungsnachweises',
      fields: {
        service_report_id: 'Leistungsnachweis',
        state: 'Eingefrorener Stand',
        fingerprint: 'Fingerabdruck',
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
        contractor_id: 'Fremdfirma aus der Liste',
        closing_reason: 'Grund',
        performed_on: 'Durchgeführt am',
        countersignature_required: 'Gegenzeichnung verlangt',
        form_key: 'Formular',
        form_version: 'Fassung des Formulars',
        template_on: 'Vorlage vom',
        round_plan_id: 'Plan',
        emptied_at: 'Gelöscht nach Ablauf der Aufbewahrung am',
        ended_on: 'Beendet am',
        reopened_at: 'Wieder geöffnet am',
        collective_id: 'Teil des Sammelvorgangs',
        collective_kind: 'Pflichtart des Sammelvorgangs',
        point_assets: 'Anlagen der Punkte für jede Anlage',
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
        more_attachment_ids: 'Weitere Fotos',
        asset_id: 'Anlage',
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
        shows_from_day: 'Sichtbar ab',
        shows_from_month: 'Sichtbar ab, Monat',
        starts_on: 'Ab',
        ends_on: 'Bis',
        resting: 'Ruht',
        skip_holidays: 'Gesetzliche Feiertage auslassen',
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
        measure: 'Einordnung nach DIN 31051',
        urgency: 'Dringlichkeit',
        origin_defect_id: 'Aus dem Mangel',
        duration_minutes: 'Dauer in Minuten',
        warranty_ends_on: 'Gewährleistung bis',
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
        typed_name: 'Getippter Name',
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
      fields: { code: 'Code', blocked_at: 'Gesperrt am', print_id: 'Druck' },
    },
    defects: {
      label: 'Mangel',
      fields: {
        found_in_activity_id: 'Festgestellt bei',
        found_in_evidence_id: 'Genannt im Nachweis',
        found_in_answer_id: 'Aus der Antwort',
        circuit_id: 'Stromkreis',
        remedy_work_order_id: 'Beseitigt mit',
        description: 'Beschreibung',
        defect_class: 'Klasse',
        found_on: 'Festgestellt am',
        due_on: 'Zu beseitigen bis',
        status: 'Stand',
        checked_on: 'Nachgeprüft am',
        check_note: 'Bemerkung zur Nachprüfung',
        remedied_on: 'Behoben am',
        emptied_at: 'Inhalt gelöscht nach Ablauf der Aufbewahrung am',
      },
    },
    // The tasks of an operator (#124). What a task hangs on is named below
    // with the fields every row with a place has.
    tasks: {
      label: 'Aufgabe',
      fields: {
        title: 'Was zu tun ist',
        due_on: 'Fällig am',
        assignee_user_id: 'Verantwortlich',
        status: 'Stand',
        activity_id: 'Vorgang',
        created_by: 'Angelegt von',
        done_on: 'Erledigt am',
      },
    },
    // The default of a class of defects, which the operator sets (#116).
    defect_class_terms: {
      label: 'Vorgabe einer Mängelklasse',
      fields: { defect_class: 'Klasse', due_days: 'Tage bis zur Beseitigung' },
    },
    // The categories of the fault reports and the reports (#331). What a
    // report hangs on is named below with the fields every row with a place has.
    fault_categories: {
      label: 'Kategorie der Störungen',
      fields: { name: 'Name', position: 'Stelle in der Auswahl', removed_at: 'Entfernt am' },
    },
    fault_reports: {
      label: 'Störmeldung',
      fields: {
        category_id: 'Kategorie',
        description: 'Beschreibung',
        photo_sha256: 'Foto',
        reported_by: 'Gemeldet von',
        reported_outside: 'Ohne Anmeldung über ein Etikett gemeldet',
        received_at: 'Eingegangen am',
        work_order_id: 'Angenommen als Auftrag',
        accepted_at: 'Angenommen am',
        rejected_at: 'Abgelehnt am',
        rejection_reason: 'Grund der Ablehnung',
        merged_into_id: 'Zusammengeführt mit',
        defect_id: 'Als Mangel gemeldet',
      },
    },
    // Whether the label takes a report without an account (#332). The
    // addresses for an answer are in no log at all (`fault_report_contacts`).
    fault_report_settings: {
      label: 'Einstellungen der Störungen',
      fields: { open_by_label: 'Melden ohne Konto über das Etikett' },
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
      // The document whose day a deadline follows (#327).
      attachment_id: 'Dokument',
      // The contract and the warranty whose day a deadline follows (#329).
      contract_id: 'Vertrag',
      warranty_asset_id: 'Gewährleistung der Anlage',
      warranty_order_id: 'Gewährleistung des Auftrags',
      // The delegation whose end a deadline follows (#336).
      delegation_id: 'Pflichtenübertragung',
      // The qualification whose expiry a deadline follows (#337).
      qualification_id: 'Qualifikation',
      evidence_id: 'Nachweis',
      // The activity without evidence whose retention a deadline follows (#412).
      activity_id: 'Vorgang',
      // The access whose end or whose removal a deadline follows (#356).
      member_user_id: 'Zugang',
      task_id: 'Aufgabe',
      property_id: 'Liegenschaft',
      area_id: 'Bereich',
    },
    attachments: {
      activity_id: 'Vorgang',
      defect_id: 'Mangel',
      // The firm whose certificate or insurance it is (#328).
      contractor_id: 'Fremdfirma',
      // The contract it belongs to (#329).
      contract_id: 'Vertrag',
      kind: 'Art',
      legacy: 'Altbestand',
    },
    // The day a version expires or is to be reviewed (#327).
    attachment_versions: { valid_until: 'Gültig bis' },
    // The firm a contact works for (#328).
    contacts: { contractor_id: 'Fremdfirma' },
  },
  // Every row with a place carries its area and the levels above it (ADR 0002,
  // point 2, and ADR 0003, point 4).
  commonFields: {
    area_id: 'Bereich',
    // The property whose area a row has, where it has that one (ADR 0003,
    // addendum of #306).
    area_from_property_id: 'Bereich der Liegenschaft',
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
      // A low-voltage installation with its boards (#349).
      { table: 'distribution_boards', column: 'asset_id' },
      // A PV installation with its inverters (#461).
      { table: 'inverters', column: 'asset_id' },
    ],
    // A board with its sections and circuits, a circuit with its equipment,
    // an inverter with its strings and a string with its modules.
    ...ofTheStructure(structureAuditParts),
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
      { table: 'service_reports', column: 'activity_id' },
      { table: 'work_order_materials', column: 'activity_id' },
      // The briefings and permits of a contractor at work (#330).
      { table: 'briefings', column: 'activity_id' },
      { table: 'work_permits', column: 'activity_id' },
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
    // A board of a low-voltage installation, from its page under the asset (#349).
    'distribution_boards',
    'duties',
    'attachments',
    'activities',
    'defects',
    'round_templates',
    'round_plans',
    'fault_reports',
    // An asset kind of the operator's own, from its page in the catalogue (#62).
    'own_asset_kinds',
  ],
  references: {
    area_id: 'areas',
    own_area_id: 'areas',
    area_from_property_id: 'properties',
    property_id: 'properties',
    building_id: 'buildings',
    floor_id: 'floors',
    room_id: 'rooms',
    asset_id: 'assets',
    parent_asset_id: 'assets',
    replaces_asset_id: 'assets',
    replaces_duty_id: 'duties',
    main_meter_id: 'assets',
    corrects_id: 'meter_readings',
    duty_id: 'duties',
    activity_id: 'activities',
    found_in_activity_id: 'activities',
    // The collective activity a part belongs to (#342).
    collective_id: 'activities',
    found_in_evidence_id: 'evidence',
    found_in_answer_id: 'activity_answers',
    remedy_work_order_id: 'work_orders',
    origin_defect_id: 'defects',
    defect_id: 'defects',
    work_order_id: 'work_orders',
    evidence_id: 'evidence',
    replaces_evidence_id: 'evidence',
    // The service report a frozen state and a print are of (#324).
    service_report_id: 'service_reports',
    // The handing in a print of a round was made of (#518).
    round_record_id: 'round_records',
    // What the stores hold (#325).
    store_id: 'stores',
    article_id: 'articles',
    supplier_id: 'suppliers',
    // The other store of a transfer (#391).
    counterpart_store_id: 'stores',
    // The firm of the list a duty, an activity and an evidence name (#328).
    contractor_id: 'contractors',
    // The contract a duty fulfils and a document belongs to (#329), and what a
    // deadline of a warranty follows.
    contract_id: 'contracts',
    warranty_asset_id: 'assets',
    warranty_order_id: 'work_orders',
    // The delegation of duties a row hangs on, and the one a duty's responsible comes from (#336).
    delegation_id: 'duty_delegations',
    responsible_delegation_id: 'duty_delegations',
    // The own kind a qualification is of, and the qualification a deadline follows (#337).
    own_kind_id: 'qualification_kinds',
    qualification_id: 'qualifications',
    // The category of a fault report and the report it went into (#331).
    category_id: 'fault_categories',
    merged_into_id: 'fault_reports',
    // A withdrawal and the shelf a label is stuck on (#326).
    material_id: 'work_order_materials',
    store_article_id: 'store_articles',
    template_id: 'round_templates',
    round_plan_id: 'round_plans',
    // The document that bears an interval of the operator's own, and the
    // version of it that was read (#259).
    interval_document_id: 'attachments',
    interval_document_version_id: 'attachment_versions',
    // What a deadline of this application hangs on beside the above.
    task_id: 'tasks',
    meter_property_id: 'properties',
    // The board, the section and the circuit a part of the electrical
    // structure hangs on (#349), the inverter and the string a part of the PV
    // structure hangs on (#461).
    ...ofTheStructure(structureAuditReferences, (_, target) => target),
  },
  // The form of a round is its template, named by a key that begins with a
  // word and ends with the id of the template; the form of an inspection is a
  // key of the catalogue, which its words name (#259).
  prefixedReferences: {
    form_key: { prefix: templateKeyPrefix, table: 'round_templates' },
  },
  // What an asset was found to be distinct from: several assets in one
  // field, each read by its name (#171).
  referenceLists: { distinct_from: 'assets' },
  personFields: [
    'substitute_user_id',
    'absent_user_id',
    'responsible_user_id',
    'performer_user_id',
    'assignee_user_id',
    'performed_by',
    'written_by',
    'signed_by',
    'decided_by',
    'voided_by',
    'confirmed_by',
    'dismissed_by',
    'note_by',
    'recorded_by',
    'booked_by',
    'taken_by',
    // Who reported a fault (#331).
    'reported_by',
    // Who filed a PDF with a higher signature (#341).
    'filed_by',
    // The person a delegation of duties goes to, and who revoked one (#336).
    'delegate_user_id',
    'revoked_by',
    // The person whose access a deadline follows (#356).
    'member_user_id',
    // Who made a description of the processing (#357).
    'made_by',
  ],
  // Rows without a name of their own are named after the person they are
  // about, and a substitution after the person whose areas it takes over.
  titles: {
    member_all_areas: ['user_id'],
    member_areas: ['user_id'],
    // What an invitation says about areas is named after the invitation.
    invitation_area_choices: ['invitation_id'],
    invitation_areas: ['invitation_id'],
    // What an access is limited to by the person, what an invitation limits to by the invitation (#339).
    member_limit_properties: ['user_id'],
    member_limit_asset_kinds: ['user_id'],
    invitation_limit_properties: ['invitation_id'],
    invitation_limit_asset_kinds: ['invitation_id'],
    substitutions: ['absent_user_id'],
    // A circuit and a piece of equipment by their designation, or else by
    // what they supply and what they are (#349), a module by its model and
    // serial number (#461).
    ...ofTheStructure(structureAuditTitles),
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
    work_order_settings: ['names_and_times'],
    fault_report_settings: ['open_by_label'],
    // An article by its number and its name, a supplier and a store by their
    // names, what a store keeps by its article, a booking by its kind.
    articles: { joined: ['number', 'designation'] },
    suppliers: ['name'],
    stores: ['name'],
    store_articles: ['article_id'],
    stock_movements: ['kind'],
    work_order_materials: ['article_id'],
    store_labels: ['code'],
    // A contractor by its name (#328).
    contractors: ['name'],
    // A contract by its title, and what it covers by the building or the asset (#329).
    contracts: ['title'],
    contract_items: ['asset_id', 'building_id'],
    // A delegation by its period, what hangs on it by the delegation (#336).
    duty_delegations: { joined: ['delegate_name', 'starts_on'] },
    duty_delegation_areas: ['delegation_id'],
    duty_delegation_signatures: ['delegation_id'],
    duty_delegation_revocations: ['delegation_id'],
    // An own kind by its label, a qualification by the person who holds it (#337).
    qualification_kinds: ['label'],
    // An own asset kind and an own field by their labels (#62).
    own_asset_kinds: ['label'],
    own_asset_fields: ['label'],
    qualifications: ['user_id'],
    // A duty of the operator's own by its name, one from the catalogue by its
    // kind; a dismissal by the kind it dismissed.
    duties: ['label', 'kind'],
    duty_dismissals: ['kind'],
    // An evidence by its number, and a declaration of invalidity by its evidence.
    evidence: ['number'],
    evidence_voidings: ['evidence_id'],
    evidence_emptyings: ['evidence_id'],
    evidence_signed_prints: ['evidence_id'],
    evidence_retention_settings: ['minimum_years'],
    // What goes after its own retention, by what it is about (#412).
    activity_emptyings: ['activity_id'],
    defect_emptyings: ['defect_id'],
    record_retention_settings: ['activity_years'],
    retention_removals: ['kind'],
    // The period after the end of an access by its days, a removal by its person (#356).
    membership_settings: ['removal_days'],
    membership_removals: ['user_id'],
    // A description of the processing by the version it holds for (#357).
    processing_descriptions: ['holds_for'],
    // A document on data protection by its kind, an activity of the record by its key (#358).
    privacy_documents: ['kind'],
    processing_record_settings: ['controller'],
    processing_record_activities: ['activity'],
    // The frozen state of a round by its round.
    round_records: ['activity_id'],
    // A PDF by what it was made of.
    prints: ['evidence_id', 'activity_id', 'service_report_id'],
    // A service report by its client, its frozen state by the report.
    service_reports: ['client_name'],
    // A briefing by whom it was of, a permit by its form (#330).
    briefings: ['person_name'],
    work_permits: ['form_key'],
    service_report_records: ['service_report_id'],
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
    // A category by its name, a fault report by what was reported (#331).
    fault_categories: ['name'],
    fault_reports: ['description'],
    // A signature by who gave it, a decision by what it decided.
    activity_signatures: ['signed_by'],
    work_order_decisions: ['decision'],
    // An asset by its number and its name: the number tells apart what
    // shares a name, and the name says what the number stands on.
    assets: { joined: ['number', 'name'] },
  },
  // A duty from the catalogue is called like its kind, and so is the same
  // duty at the next asset. Both are told apart by what they stand at (#258):
  // the asset where there is one, the room, the building or the property
  // otherwise. A dismissed proposal is always one at an asset.
  standsAt: {
    duties: ['asset_id', 'room_id', 'building_id', 'property_id'],
    duty_dismissals: ['asset_id'],
  },
  // What a deadline came from, the foundation holds as a bare id, whatever
  // sort of thing it is. Every deadline of this application names it in a
  // column of its own as well, the duty, the defect, the plan, the task or
  // the property, and that one reads as a name (#259).
  quietFields: ['source_id'],
  // What a record holds as one column of JSON and shows whole on a screen of
  // its own: the state an evidence and a round were frozen in, and the
  // chapters and points of a version of a template. The log says that it was
  // set, and the page of the record says what (#263). So does the drawing of
  // a signature: a table of the log can be changed by whoever holds it, and
  // a signature stands in none (#457, #523).
  secretFields: {
    evidence: ['state'],
    round_records: ['state'],
    service_report_records: ['state'],
    round_template_versions: ['definition'],
    activity_signatures: ['path'],
    briefings: ['path'],
    duty_delegation_signatures: ['path'],
    service_reports: ['path'],
  },
  reasons: {
    // A report over a label from somebody without an account (#332): the log
    // names no person for it, and this is why.
    'report.outside': 'Störmeldung ohne Anmeldung über ein Etikett',
  },
  rights: rightLabel,
  roles: Object.fromEntries(shippedRoles.map((role) => [role.key, role.label])),
}

/** How a message stands in its outbox, by mail or by push (#126). */
const messageStatusLabel = {
  pending: 'Wartet',
  sent: 'Gesendet',
  failed: 'Nicht zugestellt',
} as const

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
  // The kind of a booking and the unit of an article in words (#325).
  stock_movements: { kind: stockMovementKindLabel },
  articles: { unit: stockUnitLabel },
  asset_lifecycle: { state: lifecycleStateLabel },
  assets: { meter_unit: meterUnitSymbol },
  // The electrical structure in the words of its forms (#349): a board by
  // its kind, a protective device and an installation method by their name.
  distribution_boards: { kind: distributionBoardKindLabel },
  circuits: {
    overcurrent_device: overcurrentDeviceName,
    trip_characteristic: tripCharacteristicLabel,
    rcd_type: rcdTypeLabel,
    cable_installation_method: cableInstallationMethodName,
  },
  attachments: { kind: documentKindLabel },
  // The deadlines of the foundation, in the words of its list of deadlines.
  deadlines: { status: { open: 'Offen', done: 'Erledigt', dropped: 'Entfallen' } },
  deadline_settings: { reminder: deadlineReminderLabel },
  contracts: { notice_unit: noticeUnitLabel },
  duty_delegations: { scope: delegationScopeLabel },
  duty_delegation_signatures: { role: delegationRoleLabel },
  qualification_kinds: { level: personLevelLabel },
  // The sort of an own field in the words of its dialog (#62).
  own_asset_fields: { sort: ownFieldSortLabel },
  defects: { status: defectStatusLabel },
  tasks: { status: { open: 'Offen', done: 'Erledigt' } },
  duties: {
    basis: dutyBasisLabel,
    counting: countingLabel,
    performer: dutyPerformerLabel,
    task: dutyTaskLabel,
  },
  evidence: { origin: evidenceOriginLabel, result: evidenceResultLabel },
  // What a message is about and how it stands (#126): the log holds the key
  // of the occasion, the Leitung reads what the account calls it.
  mail_outbox: {
    kind: { deadline_due: 'Erinnerung an eine Frist', invitation: 'Einladung' },
    status: messageStatusLabel,
  },
  mail_settings: { security: { starttls: 'STARTTLS', tls: 'TLS', none: 'Ohne Verschlüsselung' } },
  meter_readings: { source: meterReadingSourceLabel },
  // A number range by what it counts, not by its key (#176).
  number_ranges: { key: numberRangeLabel },
  // The log holds `DE-BW`, the Leitung reads "Baden-Württemberg".
  properties: { federal_state: ruleScopeNames },
  push_outbox: {
    kind: {
      deadline_due: pushOccasionWords.deadline_due.label,
      assigned: pushOccasionWords.assigned.label,
      task_due: pushOccasionWords.task_due.label,
      waiting: pushOccasionWords.waiting.label,
      work_order_rejected: pushOccasionWords.work_order_rejected.label,
      fault_received: pushOccasionWords.fault_received.label,
      fault_answered: pushOccasionWords.fault_answered.label,
      test: 'Probenachricht',
    },
    status: messageStatusLabel,
  },
  push_subscriptions: { entry: { office: 'Büro', site: 'Vor Ort' } },
  round_plans: { rhythm: planRhythmLabel },
  work_order_decisions: { decision: workOrderDecisionLabel },
  work_order_notes: { activity_kind: activityKindLabel },
  work_order_materials: { activity_kind: activityKindLabel },
  work_order_participants: { activity_kind: activityKindLabel },
  work_orders: {
    activity_kind: activityKindLabel,
    kind: workOrderKindLabel,
    measure: basicMeasureLabel,
    urgency: workOrderUrgencyLabel,
  },
}

/**
 * What the change log says about the values of this application, on the
 * screen and in the log as a table the server writes (#236): the values of
 * a list by table and column, and the kinds of a building, which the log
 * holds as `school` and the Leitung reads as "Schule oder Hochschule".
 */
export const auditValueWords = {
  values: auditValues,
  // The days a plan walks its round on, which the log holds as `{1,3}`.
  lists: { kinds: buildingKindLabel, weekdays: weekdayLabel },
} as const

/**
 * Words by key with nothing in them but their entries. The log holds whatever
 * was written, and a value called `constructor` or `toString` is looked up
 * here like any other: a list that is an ordinary object would answer it with
 * what every object carries, and this one has no word for it.
 */
function wordsOf(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  const words = Object.create(null) as Record<string, string>

  for (const [key, word] of entries) {
    words[key] = word
  }

  return words
}

/**
 * What each key is called, in the newest version the catalogue holds of it.
 * The log holds a key and no version beside it, and a name read today is the
 * name of today.
 */
function namesByKey<Definition>(
  entries: readonly CatalogueEntry<Definition>[],
  name: (definition: Definition) => string,
): Readonly<Record<string, string>> {
  const newest = new Map<string, CatalogueEntry<Definition>>()

  for (const entry of entries) {
    const held = newest.get(entry.key)

    if (held === undefined || entry.version > held.version) {
      newest.set(entry.key, entry)
    }
  }

  return wordsOf([...newest].map(([key, entry]) => [key, name(entry.definition)]))
}

/**
 * What the change log says about the values of this application with a
 * catalogue at hand (#245): the words above, and the keys of the catalogue
 * by what they are called. The log holds `probe.elevator_main_test`, and
 * the Leitung reads "Hauptprüfung der Aufzugsanlage": as the name of a duty
 * from the catalogue and of a dismissed proposal, which have no name of
 * their own, and wherever a field holds such a key, the kind of an asset,
 * the form of an activity, the class of a defect and the template a round
 * was taken from.
 *
 * A key the catalogue at hand does not hold has no word here and stays as it
 * is written: a key says more than a record without a name. Without a
 * catalogue, on a device that has not fetched one yet, these are the words
 * above.
 */
export function auditValueWordsWith(catalogue: Catalogue | null): {
  readonly values: typeof auditValues
  readonly lists: (typeof auditValueWords)['lists']
  readonly written?: (
    table: string,
    field: string,
    raw: string,
    format: Pick<AuditFormat, 'date'>,
  ) => string | null
} {
  if (catalogue === null) {
    return auditValueWords
  }

  const packages = catalogue.bundle.packages
  // The kinds of the packages and those of the operator's own (#62).
  const assetKinds = namesByKey(
    [...packages.flatMap((entry) => entry.assetKinds), ...(catalogue.bundle.own?.assetKinds ?? [])],
    (kind) => kind.label,
  )
  const dutyKinds = namesByKey(
    packages.flatMap((entry) => entry.dutyKinds),
    (kind) => kind.label,
  )
  const forms = namesByKey(
    packages.flatMap((entry) => entry.forms),
    (form) => form.title,
  )
  const roundTemplates = namesByKey(
    packages.flatMap((entry) => entry.roundTemplates),
    (form) => form.title,
  )
  const defectClasses = wordsOf(
    packages.flatMap((entry) =>
      entry.defectClasses.map(({ defectClass }) => [defectClass.key, defectClass.label] as const),
    ),
  )

  const assetValues = assetValuesWords(catalogue)

  return {
    ...auditValueWords,
    // What an asset holds beyond the fields every asset has, as its file
    // writes it: "Feuerwehraufzug: Nein, Haltestellen: 5" (#263).
    written: (table, field, raw, format) =>
      table === 'assets' && field === 'values' ? assetValues(raw, format.date) : null,
    values: {
      ...auditValues,
      activities: { ...auditValues['activities'], form_key: forms },
      asset_kind_names: { kind: assetKinds },
      assets: { ...auditValues['assets'], kind: assetKinds },
      own_asset_fields: { ...auditValues['own_asset_fields'], asset_kind: assetKinds },
      defect_class_terms: { defect_class: defectClasses },
      defects: { ...auditValues['defects'], defect_class: defectClasses },
      duties: { ...auditValues['duties'], kind: dutyKinds },
      duty_dismissals: { kind: dutyKinds },
      round_templates: { source_key: roundTemplates },
    },
  }
}
