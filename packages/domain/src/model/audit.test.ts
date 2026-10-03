import { applicationRoleName, auditLanguage } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { auditVocabulary } from './audit.js'

// The change log in the words of this application (ADR 0010 in the repository
// opengewerk). Whether every table and column has a name the server holds
// against the database; what is held here is what only this application can
// get wrong: the words the foundation takes from it for its own tables.

const audit = auditLanguage(auditVocabulary)

describe('the change log in the words of this application', () => {
  it('calls a tenant a Betreiber and whoever runs the instance its Verwaltung', () => {
    expect(audit.tableLabel('tenants')).toBe('Betreiber')
    expect(audit.fieldLabel('memberships', 'tenant_id')).toBe('Zugang, Betreiber')
    expect(audit.tableLabel('tenant_parameters')).toBe('Einstellung des Betreibers')
    expect(audit.fieldLabel('tenant_roles', 'leads')).toBe('Rolle, Leitet den Betreiber')
    expect(audit.tableLabel('instance_operators')).toBe('Verwaltung der Instanz')
  })

  it('says the ways in its own words, a right by the label of its catalogue', () => {
    const way = (reason: string) => audit.way(reason, applicationRoleName).text

    expect(way('session.switch')).toBe('Wechsel zu einem anderen Betreiber')
    expect(way('instance.tenant')).toBe('Betreiber für andere anlegen')
    expect(way('operator.appoint')).toBe('Zur Verwaltung der Instanz benennen')
    expect(way('audit.read')).toBe('Das Änderungsprotokoll einsehen')
    expect(way('session.start')).toBe('Anmeldung')
  })

  it('names the roles a tenant begins with', () => {
    expect(auditVocabulary.roles).toEqual({
      management: 'Leitung',
      technical_management: 'Technische Leitung',
      site_management: 'Objektleitung',
      technician: 'Haustechnik',
    })
  })

  it('says "Betrieb" nowhere, the word of the trades application', () => {
    expect(JSON.stringify(auditVocabulary)).not.toMatch(/Betrieb/)
  })
})
