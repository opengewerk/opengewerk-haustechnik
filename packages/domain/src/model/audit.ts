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
  },
  // Every row with a place will carry its area (ADR 0003, point 4).
  commonFields: { area_id: 'Bereich' },
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
  references: { area_id: 'areas' },
  personFields: ['substitute_user_id', 'absent_user_id'],
  // Rows without a name of their own are named after the person they are
  // about, and a substitution after the person whose areas it takes over.
  titles: {
    member_all_areas: ['user_id'],
    member_areas: ['user_id'],
    substitutions: ['absent_user_id'],
  },
  reasons: {},
  rights: rightLabel,
  roles: Object.fromEntries(shippedRoles.map((role) => [role.key, role.label])),
}
