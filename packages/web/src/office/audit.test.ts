import { auditVocabulary } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { auditScreenWords } from './audit.js'

/**
 * What the change log says in the office beyond the vocabulary the server is
 * told as well: how a value is written, and where a record is opened.
 */
describe('the words of the change log in the office', () => {
  it('are the vocabulary the server is told', () => {
    expect(auditScreenWords.vocabulary).toBe(auditVocabulary)
  })

  it('write the state of a property as its name', () => {
    const states = auditScreenWords.values?.['properties']?.['federal_state']

    expect(states?.['DE-BW']).toBe('Baden-Württemberg')
    expect(states?.['DE-HE']).toBe('Hessen')
  })

  // The log holds `{school,assembly}`, and the Leitung reads what the form
  // offered.
  it('write the kinds of a building in the words of the form', () => {
    const kinds = auditScreenWords.lists?.['kinds']

    expect(kinds?.['school']).toBe('Schule oder Hochschule')
    expect(kinds?.['assembly']).toBe('Versammlungs- oder Sportstätte')
    expect(kinds?.['other']).toBe('Sonstiges Gebäude')
  })

  it('open a property on its page, under words of its own', () => {
    expect(auditScreenWords.href?.('properties', 'p-1')).toBe('/liegenschaften/p-1')
    expect(auditScreenWords.linkWords?.('properties')).toBe('Zur Liegenschaft')
  })

  it('open a building, a floor and a room on their pages, each under words of its own', () => {
    expect(auditScreenWords.href?.('buildings', 'b-1')).toBe('/gebaeude/b-1')
    expect(auditScreenWords.linkWords?.('buildings')).toBe('Zum Gebäude')
    expect(auditScreenWords.href?.('floors', 'f-1')).toBe('/geschosse/f-1')
    expect(auditScreenWords.linkWords?.('floors')).toBe('Zum Geschoss')
    expect(auditScreenWords.href?.('rooms', 'r-1')).toBe('/raeume/r-1')
    expect(auditScreenWords.linkWords?.('rooms')).toBe('Zum Raum')
  })

  // The log of a property takes in the people to talk to there, the log of a
  // building the times it is closed, and each says so beside the chip of the
  // record; every record the vocabulary gives parts has words for them.
  it('say what the log of a record takes in, for every record that takes something in', () => {
    expect(auditScreenWords.partsWords).toEqual({
      properties: 'mit ihren Ansprechpartnern',
      buildings: 'mit seinen Schließzeiten',
      rooms: 'mit seinen Etiketten',
      assets: 'mit ihrem Lebenszyklus, dem, was sie versorgt, und ihren Etiketten',
      attachments: 'mit seinen Fassungen',
      activities:
        'mit den Pflichten, die er erfüllen soll, den Antworten auf sein Formular und bei einem Auftrag dessen Angaben und Beteiligten',
      defects: 'mit seinen Fotos',
      round_templates: 'mit ihren Fassungen',
    })
    expect(Object.keys(auditScreenWords.partsWords ?? {})).toEqual(
      Object.keys(auditVocabulary.parts),
    )
    expect(auditVocabulary.parts).toEqual({
      properties: [{ table: 'contacts', column: 'property_id' }],
      buildings: [{ table: 'building_closures', column: 'building_id' }],
      // A label is made and blocked on the page of what it hangs on (#98).
      rooms: [{ table: 'labels', column: 'room_id' }],
      assets: [
        { table: 'asset_lifecycle', column: 'asset_id' },
        { table: 'asset_supplies', column: 'asset_id' },
        { table: 'labels', column: 'asset_id' },
      ],
      attachments: [{ table: 'attachment_versions', column: 'attachment_id' }],
      // An activity with the duties it is to meet and what came of each (#105),
      // and the answers to the points of its form (#106).
      activities: [
        { table: 'activity_duties', column: 'activity_id' },
        { table: 'activity_answers', column: 'activity_id' },
        { table: 'work_orders', column: 'activity_id' },
        { table: 'work_order_participants', column: 'activity_id' },
      ],
      // A defect with its photos (#116).
      defects: [{ table: 'attachments', column: 'defect_id' }],
      // A template of a round with its versions (#112).
      round_templates: [{ table: 'round_template_versions', column: 'template_id' }],
    })
  })

  it('open nothing for a record without a screen, whatever it is called', () => {
    for (const table of ['building_closures', 'contacts', 'areas', 'constructor', 'toString']) {
      expect(auditScreenWords.href?.(table, 'x')).toBeNull()
      expect(auditScreenWords.linkWords?.(table)).toBeNull()
    }
  })

  // The button "Änderungen" stands at a record the vocabulary names as one.
  it('have the log opened from every record that has a page', () => {
    const paged = auditVocabulary.records.filter(
      (table) => auditScreenWords.href?.(table, 'x') !== null,
    )

    expect(paged).toEqual([
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
    ])
    expect(auditVocabulary.records).toEqual([
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
    ])
  })

  // A record that opens on a page says where the link leads.
  it('name the link of every record that opens on a page', () => {
    for (const table of auditVocabulary.records) {
      expect(auditScreenWords.linkWords?.(table)).not.toBeNull()
    }
  })
})
