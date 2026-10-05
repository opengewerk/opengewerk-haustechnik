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

  it('open a property on its page, under words of its own', () => {
    expect(auditScreenWords.href?.('properties', 'p-1')).toBe('/liegenschaften/p-1')
    expect(auditScreenWords.linkWords?.('properties')).toBe('Zur Liegenschaft')
  })

  // The log of a property takes in the people to talk to there, and says so
  // beside the chip of the record; every record the vocabulary gives parts
  // has words for them.
  it('say what the log of a record takes in, for every record that takes something in', () => {
    expect(auditScreenWords.partsWords).toEqual({ properties: 'mit ihren Ansprechpartnern' })
    expect(Object.keys(auditScreenWords.partsWords ?? {})).toEqual(
      Object.keys(auditVocabulary.parts),
    )
    expect(auditVocabulary.parts).toEqual({
      properties: [{ table: 'contacts', column: 'property_id' }],
    })
  })

  it('open nothing for a record without a screen, whatever it is called', () => {
    for (const table of ['buildings', 'areas', 'constructor', 'toString']) {
      expect(auditScreenWords.href?.(table, 'x')).toBeNull()
      expect(auditScreenWords.linkWords?.(table)).toBeNull()
    }
  })

  // The button "Änderungen" stands at a record the vocabulary names as one.
  it('have the log opened from every record that has a page', () => {
    const paged = auditVocabulary.records.filter(
      (table) => auditScreenWords.href?.(table, 'x') !== null,
    )

    expect(paged).toEqual(['properties'])
    expect(auditVocabulary.records).toEqual(['properties'])
  })
})
