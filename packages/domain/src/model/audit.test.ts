import { applicationRoleName, auditLanguage } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { auditVocabulary } from './audit.js'
import { type RoundTemplateId, templateFormKey } from './round-template.js'

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

  it('tells a duty apart by what it stands at: its asset, else its room, its building or its property (#258)', () => {
    const place = { property_id: 'p-1', building_id: 'b-1', room_id: 'r-1', asset_id: 'a-1' }

    expect(audit.standsAt('duties', place)).toEqual({ table: 'assets', id: 'a-1' })
    expect(audit.standsAt('duties', { ...place, asset_id: null })).toEqual({
      table: 'rooms',
      id: 'r-1',
    })
    expect(audit.standsAt('duties', { ...place, asset_id: null, room_id: null })).toEqual({
      table: 'buildings',
      id: 'b-1',
    })
    expect(audit.standsAt('duties', { property_id: 'p-1' })).toEqual({
      table: 'properties',
      id: 'p-1',
    })
    // A dismissed proposal is one at an asset.
    expect(audit.standsAt('duty_dismissals', place)).toEqual({ table: 'assets', id: 'a-1' })
    // And nothing else is told apart that way.
    expect(audit.standsAt('assets', place)).toBeNull()
  })

  it('names an asset by its number and its name, and by its name alone where it has no number', () => {
    expect(audit.titleFrom('assets', { number: 'AN-00012', name: 'Aufzug Schulhaus' })).toBe(
      'AN-00012 Aufzug Schulhaus',
    )
    expect(audit.titleFrom('assets', { number: null, name: 'Aufzug Schulhaus' })).toBe(
      'Aufzug Schulhaus',
    )
  })

  it('reads every field that points at a record or a person by a name and not by a key (#259)', () => {
    expect(audit.referenceOf('interval_document_id')).toBe('attachments')
    expect(audit.referenceOf('interval_document_version_id')).toBe('attachment_versions')
    expect(audit.referenceOf('found_in_answer_id')).toBe('activity_answers')
    expect(audit.referenceOf('task_id')).toBe('tasks')
    expect(audit.referenceOf('meter_property_id')).toBe('properties')
    expect(audit.isPersonField('assignee_user_id')).toBe(true)
    // What a deadline came from is said by the column that names it, not by its bare id.
    expect(audit.isQuiet('source_id')).toBe(true)
  })

  it('reads the form of a round as its template, and the form of a package as a key of the catalogue', () => {
    const template = '0199aaaa-0000-7000-8000-000000000001' as RoundTemplateId

    expect(audit.prefixedReferenceOf('form_key', templateFormKey(template))).toEqual({
      table: 'round_templates',
      id: template,
    })
    expect(audit.prefixedReferenceOf('form_key', 'probe.interim_protocol')).toBeNull()
  })

  it('says of a column that holds a whole record as JSON only that it was set (#263)', () => {
    expect(audit.isSecret('evidence', 'state')).toBe(true)
    expect(audit.isSecret('round_records', 'state')).toBe(true)
    expect(audit.isSecret('round_template_versions', 'definition')).toBe(true)
    // What an asset holds is read, in words.
    expect(audit.isSecret('assets', 'values')).toBe(false)
    expect(audit.isSecret('evidence', 'number')).toBe(false)
  })

  it('names the areas, who sees which and who stands in for whom', () => {
    expect(audit.tableLabel('areas')).toBe('Bereich')
    expect(audit.fieldLabel('member_areas', 'area_id')).toBe('Bereich einer Person, Bereich')
    expect(audit.fieldLabel('substitutions', 'absent_user_id')).toBe(
      'Vertretung, Vertretene Person',
    )

    // An area moved elsewhere reads as two names, a person as a name.
    expect(audit.referenceOf('area_id')).toBe('areas')
    expect(audit.isPersonField('substitute_user_id')).toBe(true)
    expect(audit.isPersonField('absent_user_id')).toBe(true)
  })

  it('names the roles a tenant begins with', () => {
    expect(auditVocabulary.roles).toEqual({
      management: 'Leitung',
      technical_management: 'Technische Leitung',
      site_management: 'Objektleitung',
      technician: 'Haustechnik',
      reporter: 'Melder',
      auditor: 'Prüfer',
    })
  })

  it('says "Betrieb" nowhere, the word of the trades application', () => {
    expect(JSON.stringify(auditVocabulary)).not.toMatch(/Betrieb/)
  })
})
