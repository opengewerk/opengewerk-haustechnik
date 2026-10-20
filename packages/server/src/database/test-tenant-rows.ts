import { randomBytes, randomUUID } from 'node:crypto'

import { labelCodeFrom, type TenantId } from '@opengewerk/haustechnik-domain'
import { type SQL, sql } from 'drizzle-orm'

import { writtenColumns } from './test-evidence.js'

// A row in every table of a tenant, the way the test of the isolation fills
// two tenants with them, and the test of the information about a person
// (#355) fills one: every column that points at a person names the colleague
// of the tenant.

export interface Tenant {
  readonly id: TenantId
  readonly name: string
  readonly userId: string
  readonly email: string
  readonly colleagueId: string
}

/** One row for one table, as the columns it sets. */
export interface Row {
  readonly table: string
  readonly values: Readonly<Record<string, unknown>>
}

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)

/**
 * A row for a tenant in every table of a tenant that takes rows from outside.
 *
 * In the order the keys ask for. Every value that has to be unique is made
 * anew on each call, so the same rows can be offered a second time: once to
 * fill the tables, and once by the other tenant, which is the attempt below.
 *
 * Three tables of a tenant are missing on purpose. `audit_chains` and
 * `audit_entries` are written by the trigger while the rows here go in, and
 * `sync_sequences` by the function that hands out the number of a change.
 *
 * A table that a later migration adds gets its row here. Without one the
 * tenant has nothing in it, and the tests below say so by name.
 */
export function rowsOf(tenant: Tenant): readonly Row[] {
  const invitation = randomUUID()
  const device = randomUUID()
  const area = randomUUID()
  const property = randomUUID()
  const building = randomUUID()
  const floor = randomUUID()
  const asset = randomUUID()
  // A low-voltage installation, which alone takes a board (#349).
  const installation = randomUUID()
  const board = randomUUID()
  const section = randomUUID()
  const circuit = randomUUID()
  // A PV installation, which alone takes an inverter (#461).
  const pvInstallation = randomUUID()
  const inverter = randomUUID()
  const pvString = randomUUID()
  const duty = randomUUID()
  const activity = randomUUID()
  const template = randomUUID()
  const plan = randomUUID()
  const workOrder = randomUUID()
  const evidence = randomUUID()
  // An earlier evidence of the duty, emptied after the end of its retention (#340).
  const earlier = randomUUID()
  const serviceReport = randomUUID()
  const article = randomUUID()
  const supplier = randomUUID()
  const store = randomUUID()
  const shelf = randomUUID()
  const material = randomUUID()
  const document = randomUUID()
  const firm = randomUUID()
  const contract = randomUUID()
  const delegation = randomUUID()
  const ownKind = randomUUID()
  const category = randomUUID()
  const takenOver = randomUUID()
  const faultReport = randomUUID()
  const file = randomUUID().replaceAll('-', '').repeat(2)

  return [
    {
      table: 'tenants',
      values: { id: tenant.id, name: tenant.name },
    },
    {
      table: 'tenant_roles',
      values: {
        tenant_id: tenant.id,
        key: `lead-${randomUUID().slice(0, 8)}`,
        label: 'Leitung',
        rights: ['membership.read', 'membership.write'],
        leads: true,
        second_factor: true,
      },
    },
    {
      table: 'memberships',
      values: { tenant_id: tenant.id, user_id: tenant.userId, roles: ['lead'] },
    },
    {
      table: 'memberships',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId, roles: ['lead'] },
    },
    {
      table: 'member_passkeys',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.userId,
        passkey_id: `passkey-${randomUUID()}`,
        name: 'Schlüssel am Telefon',
      },
    },
    {
      // A new password of an account that works here (#360), never its link.
      table: 'password_resets',
      values: { tenant_id: tenant.id, user_id: tenant.userId },
    },
    {
      // A change of the mail server of the instance, as every operator keeps
      // it (#360).
      table: 'account_mail_server_changes',
      values: {
        tenant_id: tenant.id,
        host_after: 'mail.instanz.example',
        from_after: 'zugang@instanz.example',
      },
    },
    {
      table: 'account_corrections',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.colleagueId,
        name_before: 'Kolege',
        name_after: 'Kollege',
      },
    },
    {
      table: 'invitations',
      values: {
        id: invitation,
        tenant_id: tenant.id,
        email: `neu-${randomUUID().slice(0, 8)}@beispiel.example`,
        name: 'Neu im Haus',
        roles: ['lead'],
        token_hash: randomUUID(),
        invited_by: tenant.userId,
        expires_at: tomorrow,
      },
    },
    {
      table: 'tenant_sessions',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.userId,
        session_id: `session-${randomUUID()}`,
      },
    },
    {
      table: 'sync_operations',
      values: {
        id: randomUUID(),
        tenant_id: tenant.id,
        entity: 'record',
        record_id: randomUUID(),
        outcome: 'applied',
        device_id: 'tablet',
      },
    },
    {
      table: 'sync_conflicts',
      values: {
        tenant_id: tenant.id,
        operation_id: randomUUID(),
        entity: 'record',
        record_id: randomUUID(),
        reason: 'changed_elsewhere',
        fields: ['name'],
        wanted: { name: 'wanted' },
        seen: { name: 'seen' },
        found: { name: 'found' },
        device_id: 'tablet',
        user_id: tenant.userId,
        recorded_at: new Date(),
      },
    },
    {
      table: 'number_ranges',
      values: { tenant_id: tenant.id, key: 'asset', pattern: 'A-{number:5}' },
    },
    {
      table: 'secrets',
      values: {
        tenant_id: tenant.id,
        purpose: 'smtp_password',
        sealed: `sealed-${randomUUID()}`,
      },
    },
    // The files and the mail server of a tenant come with the foundation (#23).
    // A file is written through the route of the foundation (#96); nothing in
    // this application writes a mail server before its screen, the test does.
    {
      table: 'files',
      values: {
        tenant_id: tenant.id,
        sha256: file,
        size_bytes: 2048,
        media_type: 'application/pdf',
      },
    },
    {
      // Who stored the file (#360): a row the person it names alone reads.
      table: 'file_uploads',
      values: { tenant_id: tenant.id, sha256: file, user_id: tenant.userId },
    },
    {
      table: 'mail_settings',
      values: {
        tenant_id: tenant.id,
        host: 'mail.beispiel.example',
        port: 587,
        security: 'starttls',
        from_address: `technik-${tenant.id.slice(0, 8)}@beispiel.example`,
      },
    },
    // What a tenant sets for a kind of deadline and when the engine last went
    // through it come with the foundation (#24). The deadlines themselves come
    // with the duties (#25); until then only the test writes either table.
    {
      table: 'deadline_settings',
      values: {
        tenant_id: tenant.id,
        kind: 'probe.inspection',
        lead_days: 14,
        interval_months: 12,
        responsible_user_id: tenant.userId,
      },
    },
    {
      table: 'deadline_runs',
      values: { tenant_id: tenant.id, succeeded_at: new Date() },
    },
    // A first membership gives a tenant its first area, so the area here is a
    // second one beside it, under a name of its own.
    {
      table: 'areas',
      values: { id: area, tenant_id: tenant.id, name: `Bereich ${area.slice(0, 8)}` },
    },
    {
      table: 'member_areas',
      values: { tenant_id: tenant.id, user_id: tenant.userId, area_id: area },
    },
    {
      table: 'member_all_areas',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId },
    },
    // What the invitation above says about areas: the ones named, and one.
    {
      table: 'invitation_area_choices',
      values: { tenant_id: tenant.id, invitation_id: invitation, every_area: false },
    },
    {
      table: 'invitation_areas',
      values: { tenant_id: tenant.id, invitation_id: invitation, area_id: area },
    },
    {
      table: 'substitutions',
      values: {
        tenant_id: tenant.id,
        substitute_user_id: tenant.userId,
        absent_user_id: tenant.colleagueId,
        starts_on: '2026-10-05',
        ends_on: '2026-10-09',
      },
    },
    // The place, from the property to the room, in the area above.
    {
      table: 'properties',
      values: {
        id: property,
        tenant_id: tenant.id,
        area_id: area,
        name: 'Wohnanlage Nordstraße',
        street: 'Nordstraße 12',
        postal_code: '68535',
        city: 'Edingen-Neckarhausen',
        federal_state: 'DE-BW',
      },
    },
    {
      table: 'buildings',
      values: {
        id: building,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        name: 'Haus A',
        kinds: ['residential'],
      },
    },
    {
      table: 'contacts',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        family_name: 'Becker',
        role: 'Hausmeister',
      },
    },
    {
      table: 'building_closures',
      values: {
        tenant_id: tenant.id,
        building_id: building,
        property_id: property,
        area_id: area,
        starts_on: '2026-12-24',
        ends_on: '2027-01-06',
        reason: 'Weihnachtsferien',
      },
    },
    {
      table: 'floors',
      values: {
        id: floor,
        tenant_id: tenant.id,
        building_id: building,
        property_id: property,
        area_id: area,
        name: 'Erdgeschoss',
        level: 0,
      },
    },
    {
      table: 'rooms',
      values: {
        tenant_id: tenant.id,
        floor_id: floor,
        building_id: building,
        property_id: property,
        area_id: area,
        number: '0.01',
      },
    },
    {
      table: 'assets',
      values: {
        id: asset,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        building_id: building,
        kind: 'probe.elevator',
        number: 'AN-00001',
        name: 'Aufzug',
      },
    },
    {
      table: 'asset_lifecycle',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        state: 'in_service',
        valid_from: '2020-01-01',
      },
    },
    {
      table: 'asset_supplies',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        building_id: building,
      },
    },
    // What a measuring point holds beside its asset (#119).
    {
      table: 'meter_points',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        conversion_factor: 40,
        lock_reason: 'Schacht überflutet',
        locked_on: '2026-10-06',
      },
    },
    {
      table: 'meter_readings',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        key_date: '2026-10-01',
        read_on: '2026-10-05',
        value_milli: 4_812_000,
        source: 'by_hand',
        recorded_by: tenant.userId,
      },
    },
    {
      table: 'meter_exchanges',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        exchanged_on: '2026-10-14',
        old_number: '13-882914',
        old_end_milli: 4_839_700,
        new_number: '13-920455',
        new_start_milli: 0,
      },
    },
    {
      table: 'meter_pauses',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        starts_on: '2026-08-01',
        ends_on: '2026-09-15',
        reason: 'Sommerferien',
      },
    },
    // The electrical structure below a low-voltage installation (#349).
    {
      table: 'assets',
      values: {
        id: installation,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        building_id: building,
        kind: 'elektro.low_voltage_installation',
        number: 'AN-00002',
        name: 'Niederspannungsanlage',
      },
    },
    {
      table: 'distribution_boards',
      values: {
        id: board,
        tenant_id: tenant.id,
        asset_id: installation,
        property_id: property,
        area_id: area,
        kind: 'main_distribution',
        designation: 'HV',
      },
    },
    {
      table: 'board_sections',
      values: {
        id: section,
        tenant_id: tenant.id,
        distribution_board_id: board,
        asset_id: installation,
        property_id: property,
        area_id: area,
        designation: 'Feld 1',
      },
    },
    {
      table: 'circuits',
      values: {
        id: circuit,
        tenant_id: tenant.id,
        distribution_board_id: board,
        board_section_id: section,
        asset_id: installation,
        property_id: property,
        area_id: area,
        designation: 'F1',
        overcurrent_device: 'circuit_breaker',
        trip_characteristic: 'b',
        rated_current_milli: 16000,
      },
    },
    {
      table: 'equipment',
      values: {
        tenant_id: tenant.id,
        circuit_id: circuit,
        asset_id: installation,
        property_id: property,
        area_id: area,
        designation: 'Steckdose Flur',
      },
    },
    // The PV structure below a PV installation (#461).
    {
      table: 'assets',
      values: {
        id: pvInstallation,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        building_id: building,
        kind: 'elektro.photovoltaic_installation',
        number: 'AN-00003',
        name: 'PV-Anlage Dach',
      },
    },
    {
      table: 'inverters',
      values: {
        id: inverter,
        tenant_id: tenant.id,
        asset_id: pvInstallation,
        property_id: property,
        area_id: area,
        designation: 'WR 1',
        rated_power_w: 10000,
        mpp_inputs: 2,
      },
    },
    {
      table: 'pv_strings',
      values: {
        id: pvString,
        tenant_id: tenant.id,
        inverter_id: inverter,
        asset_id: pvInstallation,
        property_id: property,
        area_id: area,
        designation: 'String 1',
        mpp_input: 1,
      },
    },
    {
      table: 'pv_modules',
      values: {
        tenant_id: tenant.id,
        pv_string_id: pvString,
        asset_id: pvInstallation,
        property_id: property,
        area_id: area,
        serial_number: 'BS4-2306-1101',
        rated_power_w: 400,
      },
    },
    // The key day of the meters of an operator (#120).
    { table: 'meter_settings', values: { tenant_id: tenant.id, key_day: 15 } },
    // Whether the service report names the people who did the work (#324).
    { table: 'work_order_settings', values: { tenant_id: tenant.id, names_and_times: true } },
    // The stores, without an area (#325): an article, a supplier, a store,
    // its minimum of the article and a receipt.
    {
      table: 'articles',
      values: {
        id: article,
        tenant_id: tenant.id,
        number: 'A-1002',
        designation: 'Akku Notleuchte',
        unit: 'piece',
        price_cents: 890,
      },
    },
    { table: 'suppliers', values: { id: supplier, tenant_id: tenant.id, name: 'Großhandel' } },
    // A contractor of the operator (#328).
    {
      table: 'contractors',
      values: {
        id: firm,
        tenant_id: tenant.id,
        name: 'Brandschutz Beispiel GmbH',
        services: ['450'],
      },
    },
    // A contract with it, and the asset it covers (#329).
    {
      table: 'contracts',
      values: {
        id: contract,
        tenant_id: tenant.id,
        contractor_id: firm,
        title: 'Wartung der Brandmeldeanlage',
        starts_on: '2026-01-01',
      },
    },
    {
      table: 'contract_items',
      values: {
        tenant_id: tenant.id,
        contract_id: contract,
        property_id: property,
        area_id: area,
        asset_id: asset,
      },
    },
    // A delegation of the duties with its area, signed for the operator and revoked (#336).
    {
      table: 'duty_delegations',
      values: {
        id: delegation,
        tenant_id: tenant.id,
        delegate_user_id: tenant.userId,
        delegate_name: 'Jörg Albrecht',
        scope: 'all',
        tasks: 'Organisation der Prüfungen.',
        powers: 'Weisungsbefugnis im Bereich.',
        starts_on: '2026-11-01',
        ends_on: '2028-10-31',
      },
    },
    {
      table: 'duty_delegation_areas',
      values: { tenant_id: tenant.id, delegation_id: delegation, area_id: area },
    },
    {
      table: 'duty_delegation_signatures',
      values: {
        tenant_id: tenant.id,
        delegation_id: delegation,
        role: 'operator',
        signed_by: tenant.userId,
        signed_at: '2026-10-16T10:12:00Z',
        typed_name: 'Sabine Krämer',
        page_fingerprint: 'a'.repeat(64),
      },
    },
    {
      table: 'duty_delegation_revocations',
      values: {
        tenant_id: tenant.id,
        delegation_id: delegation,
        effective_on: '2026-12-15',
        reason: 'Wechsel in die Liegenschaftsverwaltung.',
        revoked_by: tenant.userId,
        revoked_at: '2026-12-01T09:00:00Z',
      },
    },
    // A kind of the operator's own and a qualification of the person (#337).
    {
      table: 'qualification_kinds',
      values: {
        id: ownKind,
        tenant_id: tenant.id,
        label: 'Hygieneschulung',
        level: 'instructed_person',
      },
    },
    {
      table: 'qualifications',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.userId,
        own_kind_id: ownKind,
        valid_until: '2027-03-31',
      },
    },
    // What an auditor from outside is limited to, what an invitation limits to, and the log of the reads (#339).
    {
      table: 'member_limit_properties',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId, property_id: property },
    },
    {
      table: 'member_limit_asset_kinds',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId, asset_kind: 'probe.elevator' },
    },
    {
      table: 'invitation_limit_properties',
      values: { tenant_id: tenant.id, invitation_id: invitation, property_id: property },
    },
    {
      table: 'invitation_limit_asset_kinds',
      values: { tenant_id: tenant.id, invitation_id: invitation, asset_kind: 'probe.elevator' },
    },
    {
      table: 'auditor_reads',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.colleagueId,
        route: '/duties/register',
        path: '/duties/register',
      },
    },
    { table: 'stores', values: { id: store, tenant_id: tenant.id, name: 'Hauptlager' } },
    {
      table: 'store_articles',
      values: {
        id: shelf,
        tenant_id: tenant.id,
        store_id: store,
        article_id: article,
        bin: 'Regal 1, Fach 2',
        minimum_milli: 10000,
      },
    },
    {
      table: 'stock_movements',
      values: {
        tenant_id: tenant.id,
        store_id: store,
        article_id: article,
        kind: 'receipt',
        quantity_milli: 6000,
        supplier_id: supplier,
        booked_by: tenant.userId,
      },
    },
    // A duty from the catalogue at the asset, and a proposal dismissed there.
    {
      table: 'duties',
      values: {
        id: duty,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        kind: 'probe.elevator_main_test',
        kind_version: 1,
        counting: 'betrsichv',
        interval_months: 24,
        maximum_months: 24,
        responsible_user_id: tenant.userId,
        confirmed_by: tenant.userId,
      },
    },
    {
      table: 'duty_dismissals',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        kind: 'probe.elevator_annual_check',
        kind_version: 1,
        reason: 'Die Anlage hat keine Notrufeinrichtung.',
        dismissed_by: tenant.colleagueId,
      },
    },
    // An evidence of the duty, and the deadline the engine keeps from it.
    {
      table: 'evidence',
      values: {
        id: evidence,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        duty_id: duty,
        performed_on: '2025-03-14',
        result: 'without_defects',
        ...writtenColumns(tenant.userId, '2025-03-14', 'without_defects'),
      },
    },
    // Its retention ended with the evidence above, and whoever leads confirmed it (#340).
    {
      table: 'evidence',
      values: {
        id: earlier,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        duty_id: duty,
        performed_on: '2024-03-14',
        result: 'without_defects',
        ...writtenColumns(tenant.userId, '2024-03-14', 'without_defects'),
      },
    },
    {
      table: 'evidence_emptyings',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        evidence_id: earlier,
        confirmed_by: tenant.userId,
        ended_on: '2025-03-14',
      },
    },
    { table: 'evidence_retention_settings', values: { tenant_id: tenant.id, minimum_years: null } },
    // The period after the end of an access, and when the data of one went (#356).
    { table: 'membership_settings', values: { tenant_id: tenant.id, removal_days: 90 } },
    {
      table: 'membership_removals',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId, account_removed: false },
    },
    // A value of the log blacked out (#355). The fill writes it through the
    // application, below, because the trigger in front of the table asks for
    // the tenant of the session and whoever leads it; this row is the one the
    // other tenant offers.
    {
      table: 'audit_redactions',
      values: {
        tenant_id: tenant.id,
        entry_id: randomUUID(),
        side: 'new',
        reason: 'Auskunft der Person',
        redacted_by: tenant.colleagueId,
      },
    },
    // A description of the processing the Leitung made (#357).
    {
      table: 'processing_descriptions',
      values: {
        tenant_id: tenant.id,
        made_by: tenant.colleagueId,
        text: '# Verfahrensbeschreibung',
      },
    },
    // The documents on data protection and what the Leitung wrote for the record (#358).
    {
      table: 'privacy_documents',
      values: {
        tenant_id: tenant.id,
        kind: 'record',
        made_by: tenant.colleagueId,
        text: '# Verzeichnis der Verarbeitungstätigkeiten',
      },
    },
    {
      table: 'processing_record_settings',
      values: { tenant_id: tenant.id, controller: 'Probe GmbH', officer: null },
    },
    {
      table: 'processing_record_activities',
      values: {
        tenant_id: tenant.id,
        activity: 'accounts',
        purpose: 'Anmeldung',
        legal_basis: 'Art. 6 Abs. 1 lit. b DSGVO',
      },
    },
    {
      table: 'deadlines',
      values: {
        tenant_id: tenant.id,
        kind: 'duty.due',
        source_id: duty,
        source_label: 'Hauptprüfung der Aufzugsanlage, Aufzug',
        anchor_on: '2025-03-14',
        due_on: '2027-03-01',
        duty_id: duty,
        property_id: property,
        area_id: area,
      },
    },
    // A work order at the asset to meet the duty, and a defect noticed in it.
    {
      table: 'activities',
      values: {
        id: activity,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        kind: 'work_order',
        title: 'Hauptprüfung Aufzug',
        responsible_user_id: tenant.userId,
      },
    },
    {
      table: 'activity_duties',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        duty_id: duty,
      },
    },
    // The template of a round with its first version (#112).
    {
      table: 'round_templates',
      values: { id: template, tenant_id: tenant.id, title: 'Technikzentrale' },
    },
    {
      table: 'round_template_versions',
      values: {
        tenant_id: tenant.id,
        template_id: template,
        form_version: 1,
        definition: JSON.stringify({ title: 'Technikzentrale', sections: [] }),
        asks_countersignature: false,
      },
    },
    // The plan of a round at the building, and its deadline (#113).
    {
      table: 'round_plans',
      values: {
        id: plan,
        tenant_id: tenant.id,
        property_id: property,
        building_id: building,
        area_id: area,
        template_id: template,
        rhythm: 'weekly',
        weekdays: '{3}',
        starts_on: '2026-10-07',
      },
    },
    {
      table: 'activity_answers',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        field_key: 'door_closed',
        result: 'ok',
      },
    },
    {
      table: 'work_orders',
      values: {
        id: workOrder,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        number: 'AU-2026-0001',
        kind: 'inspection',
      },
    },
    {
      table: 'work_order_participants',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        user_id: tenant.colleagueId,
      },
    },
    // Material taken for the work order, its booking in the store and the
    // label on the shelf (#326).
    {
      table: 'work_order_materials',
      values: {
        id: material,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        store_id: store,
        article_id: article,
        quantity_milli: 1000,
        taken_at: '2026-10-01T09:20:00Z',
        taken_by: tenant.colleagueId,
      },
    },
    {
      table: 'stock_movements',
      values: {
        tenant_id: tenant.id,
        store_id: store,
        article_id: article,
        kind: 'withdrawal',
        quantity_milli: 1000,
        booked_by: tenant.colleagueId,
        material_id: material,
      },
    },
    {
      table: 'store_labels',
      values: {
        tenant_id: tenant.id,
        store_article_id: shelf,
        code: labelCodeFrom(randomBytes(10)),
      },
    },
    // A note on the work order (#118).
    {
      table: 'work_order_notes',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        text: 'Notrufgerät getauscht, Verbindung steht.',
        written_at: '2026-10-01T09:20:00Z',
        written_by: tenant.colleagueId,
      },
    },
    {
      table: 'defects',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        found_in_activity_id: activity,
        description: 'Notruf im Fahrkorb ohne Verbindung.',
        found_on: '2026-10-01',
      },
    },
    // A category of the fault reports and a report at the asset, with a file
    // as its photo (#331).
    {
      table: 'fault_categories',
      values: { id: category, tenant_id: tenant.id, name: 'Aufzug', position: 0 },
    },
    {
      table: 'fault_reports',
      values: {
        id: faultReport,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        building_id: building,
        asset_id: asset,
        category_id: category,
        description: 'Der Aufzug hält zwischen den Geschossen.',
        photo_sha256: file,
        reported_by: tenant.userId,
      },
    },
    // Whether the label takes a report without an account, and the address
    // for the answer to one (#332).
    { table: 'fault_report_settings', values: { tenant_id: tenant.id, open_by_label: true } },
    {
      table: 'fault_report_contacts',
      values: {
        tenant_id: tenant.id,
        fault_report_id: faultReport,
        property_id: property,
        area_id: area,
        address: 'melder@beispiel.example',
      },
    },
    // The signature on the work order, and its rejection.
    {
      table: 'activity_signatures',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        signed_by: tenant.userId,
        role: 'signer',
        signed_at: '2026-10-01T09:30:00Z',
        path: 'M10,10L200,300',
        page_fingerprint: 'a'.repeat(64),
      },
    },
    {
      table: 'work_order_decisions',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        work_order_id: workOrder,
        decision: 'rejected',
        reason: 'Die Notrufverbindung fehlt noch.',
        decided_by: tenant.colleagueId,
      },
    },
    // The evidence declared invalid.
    {
      table: 'evidence_voidings',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        evidence_id: evidence,
        reason: 'Der Prüfbericht gehört zu einer anderen Anlage.',
        voided_by: tenant.colleagueId,
      },
    },
    // The frozen state of the round as a whole, and the PDF of the evidence (#111).
    {
      table: 'round_records',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        state: JSON.stringify({ version: 1, title: 'Aufzug Haus A' }),
        fingerprint: 'c'.repeat(64),
      },
    },
    {
      table: 'prints',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        evidence_id: evidence,
        sha256: file,
      },
    },
    // The PDF of the evidence with a higher signature, signed outside (#341).
    {
      table: 'evidence_signed_prints',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        evidence_id: evidence,
        sha256: file,
        signer: 'Dr. Anna Becker, Prüfstelle Probe GmbH',
        issuer: 'Dr. Anna Becker, Prüfstelle Probe GmbH',
        valid_from: '2026-01-01T00:00:00Z',
        valid_to: '2036-01-01T00:00:00Z',
        filed_by: tenant.userId,
      },
    },
    // The client's signature under the service report of the work order and
    // its frozen state (#324).
    {
      table: 'service_reports',
      values: {
        id: serviceReport,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        client_name: 'Petra Lang',
        path: 'M10,10L200,300',
        signed_by: tenant.userId,
        signed_at: '2026-10-01T09:20:00Z',
        page_fingerprint: 'd'.repeat(64),
      },
    },
    {
      table: 'service_report_records',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        service_report_id: serviceReport,
        state: JSON.stringify({ version: 1, holder: 'Tobias Wendt' }),
        fingerprint: 'e'.repeat(64),
      },
    },
    // A briefing of a person of the firm and a permit for hot work at the
    // work order (#330).
    {
      table: 'briefings',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        contractor_id: firm,
        person_name: 'Marco Petri',
        subject: 'Fluchtwege',
        path: 'M10,10L200,300',
        signed_by: tenant.userId,
        signed_at: '2026-10-01T08:00:00Z',
      },
    },
    {
      table: 'work_permits',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        contractor_id: firm,
        form_key: 'brandschutz.hot_work_permit',
        form_version: 1,
        answers: JSON.stringify({ place: 'Heizraum' }),
        signed_by: tenant.userId,
        signed_at: '2026-10-01T08:05:00Z',
      },
    },
    // A document at the asset, and the one version of it, which names the
    // file of the tenant above.
    {
      table: 'attachments',
      values: {
        id: document,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        title: 'Betriebsanleitung',
        kind: 'operating_manual',
      },
    },
    {
      table: 'attachment_versions',
      values: {
        tenant_id: tenant.id,
        attachment_id: document,
        sha256: file,
        file_name: 'betriebsanleitung.pdf',
        media_type: 'application/pdf',
        size_bytes: 2048,
      },
    },
    // The label on the asset. Its code stands once in the whole instance, so
    // each tenant of the test gets one of its own.
    {
      table: 'labels',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        code: labelCodeFrom(randomBytes(10)),
      },
    },
    // An import and what a list calls an asset kind (#100). Neither has a place.
    {
      table: 'imports',
      values: {
        id: takenOver,
        tenant_id: tenant.id,
        kind: 'assets',
        file_name: 'anlagen-werkhof.xlsx',
        lines: 38,
        summary: '38 Anlagen angelegt',
      },
    },
    // An asset kind and a field of the operator's own (#62), with no place either.
    {
      table: 'own_asset_kinds',
      values: {
        tenant_id: tenant.id,
        key: 'eigen.hebeanlage',
        label: 'Hebeanlage',
        cost_group: '411',
      },
    },
    {
      table: 'own_asset_fields',
      values: {
        tenant_id: tenant.id,
        asset_kind: 'eigen.hebeanlage',
        key: 'eigen_foerdermenge',
        label: 'Fördermenge',
        sort: 'number',
      },
    },
    // What the import made (#174), with no place of its own either.
    {
      table: 'import_records',
      values: {
        tenant_id: tenant.id,
        import_id: takenOver,
        table_name: 'assets',
        record_id: asset,
      },
    },
    {
      table: 'asset_kind_names',
      values: {
        tenant_id: tenant.id,
        name: 'Feuerlöscher',
        name_key: 'feuerlöscher',
        kind: 'allgemein.other_technical_installation',
      },
    },
    // The default of a class of defects (#116). It has no place either.
    {
      table: 'defect_class_terms',
      values: { tenant_id: tenant.id, defect_class: 'allgemein.significant', due_days: 14 },
    },
    // A task at the asset, for whoever leads the tenant (#124).
    {
      table: 'tasks',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        title: 'Typenschild fotografieren',
        due_on: '2026-10-20',
        assignee_user_id: tenant.userId,
      },
    },
    // A message by mail, a device that takes push, an occasion its person
    // switched off and a push message to that device (#126).
    {
      table: 'mail_outbox',
      values: {
        tenant_id: tenant.id,
        kind: 'deadline_due',
        cause: 'deadline_due:probe:2027-03-01',
        sender_name: tenant.name,
        recipient_address: tenant.email,
        subject: 'Frist am 01.03.2027: Fälligkeit einer Pflicht',
        body: 'Guten Tag',
      },
    },
    {
      table: 'push_subscriptions',
      values: {
        id: device,
        tenant_id: tenant.id,
        user_id: tenant.userId,
        entry: 'office',
        label: 'Firefox auf Windows',
        endpoint: `https://push.example.com/${tenant.id}`,
        p256dh: 'BPublic',
        auth: 'Secret',
      },
    },
    {
      table: 'push_opt_outs',
      values: { tenant_id: tenant.id, user_id: tenant.userId, occasion: 'task_due' },
    },
    {
      table: 'push_outbox',
      values: {
        tenant_id: tenant.id,
        kind: 'deadline_due',
        cause: 'deadline_due:probe:2027-03-01',
        subscription_id: device,
        title: 'Frist am 01.03.2027',
        body: 'Fälligkeit einer Pflicht',
        url: '/fristen',
        expires_at: '2038-01-01T00:00:00Z',
      },
    },
  ]
}

/**
 * A row in every table that belongs to the instance and to no tenant: the
 * accounts with what somebody signs in with, and who runs the instance.
 *
 * `instance_settings` holds its one row since the migration, and
 * `instance_changes` is written by the trigger while these go in.
 */
export function rowsOfTheInstance(north: Tenant, south: Tenant): readonly Row[] {
  const person = (tenant: Tenant): Row => ({
    table: 'auth_users',
    values: { id: tenant.userId, name: `Leitung ${tenant.name}`, email: tenant.email },
  })
  const colleague = (tenant: Tenant): Row => ({
    table: 'auth_users',
    values: {
      id: tenant.colleagueId,
      name: `Kollegium ${tenant.name}`,
      email: `kollegium-${tenant.email}`,
    },
  })

  return [
    person(north),
    person(south),
    colleague(north),
    colleague(south),
    {
      table: 'auth_accounts',
      values: {
        id: randomUUID(),
        account_id: north.userId,
        provider_id: 'credential',
        user_id: north.userId,
      },
    },
    {
      table: 'auth_passkeys',
      values: {
        id: randomUUID(),
        user_id: north.userId,
        public_key: 'public-key',
        credential_id: randomUUID(),
        counter: 0,
        device_type: 'singleDevice',
        backed_up: false,
      },
    },
    {
      table: 'auth_rate_limits',
      values: { id: randomUUID(), key: 'sign-in', count: 1, last_request: 1 },
    },
    {
      table: 'auth_sessions',
      values: {
        id: randomUUID(),
        token: randomUUID(),
        user_id: north.userId,
        expires_at: tomorrow,
      },
    },
    {
      table: 'auth_two_factors',
      values: { id: randomUUID(), user_id: north.userId, secret: 'sealed', backup_codes: 'sealed' },
    },
    {
      table: 'auth_verifications',
      values: {
        id: randomUUID(),
        identifier: 'reset-password',
        value: north.userId,
        expires_at: tomorrow,
      },
    },
    {
      table: 'instance_operators',
      values: { user_id: north.userId },
    },
  ]
}

/** The statement that puts a row in. Every value travels beside it, as a parameter. */
export function insertOf(row: Row): SQL {
  const columns = Object.keys(row.values)

  return sql`insert into ${sql.identifier(row.table)} (${sql.join(
    columns.map((column) => sql.identifier(column)),
    sql`, `,
  )}) values (${sql.join(
    columns.map((column) => sql.param(row.values[column])),
    sql`, `,
  )})`
}
