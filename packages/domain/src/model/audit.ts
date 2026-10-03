import type { AuditVocabulary } from '@opengewerk/platform-domain'

import { rightLabel, shippedRoles } from './rights.js'

/**
 * The change log of a tenant in the words of this application (Abschnitt 3 of
 * the concept: "Änderungsprotokoll über alle Module, für die Leitung
 * einsehbar"). The foundation reads the log, holds the rules and names its
 * own tables, those of tenants, accounts, roles and the instance (ADR 0010 in
 * the repository opengewerk); this is what it is told, as one value.
 *
 * So far the tables of the foundation are all there are. Each table this
 * application adds gets its words here, and the server's test against the
 * catalogue fails until it has them.
 */
export const auditVocabulary: AuditVocabulary = {
  tables: {},
  commonFields: {},
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
  references: {},
  personFields: [],
  titles: {},
  reasons: {},
  rights: rightLabel,
  roles: Object.fromEntries(shippedRoles.map((role) => [role.key, role.label])),
}
