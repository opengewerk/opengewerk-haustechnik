import { contactTextFields } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { contactLimits, propertyContacts } from './contact.js'

const subjects = {
  givenName: 'Der Vorname',
  familyName: 'Der Nachname',
  role: 'Die Funktion',
  phone: 'Die Telefonnummer',
  email: 'Die E-Mail-Adresse',
} as const

describe('somebody to talk to at a property', () => {
  it('hangs on a property, and on nothing else', () => {
    expect(propertyContacts.parents).toEqual(['propertyId'])
    expect(propertyContacts.parentProblem({ propertyId: 'a-property' })).toBeNull()
    expect(propertyContacts.parentOf({ propertyId: 'a-property' })).toEqual({
      field: 'propertyId',
      id: 'a-property',
    })
  })

  it('is told in a sentence that it belongs to a property when it names none', () => {
    for (const none of [{}, { propertyId: null }, { propertyId: '' }]) {
      expect(propertyContacts.parentProblem(none)).toBe('none')
      expect(propertyContacts.parentOf(none)).toBeNull()
    }

    expect(propertyContacts.parentText.none).toBe(
      'Ein Ansprechpartner gehört zu einer Liegenschaft, dieser zu keiner.',
    )
  })

  it('needs a family name and nothing else', () => {
    expect(propertyContacts.personProblems({ familyName: 'Becker' })).toEqual({})
    expect(
      propertyContacts.personProblems({
        givenName: null,
        familyName: 'Becker',
        role: null,
        phone: null,
        email: null,
      }),
    ).toEqual({})
    expect(propertyContacts.personProblems({ givenName: 'Jens', familyName: ' ' })).toEqual({
      familyName: 'Der Nachname fehlt.',
    })
  })

  it('has a bound for every text a contact has', () => {
    expect(Object.keys(contactLimits).sort()).toEqual([...contactTextFields].sort())
  })

  it('may be as long as the bounds and no longer, spaces around a text not counted', () => {
    for (const field of contactTextFields) {
      const limit = contactLimits[field]
      const person = { familyName: 'Becker' }

      expect(
        propertyContacts.personProblems({ ...person, [field]: ` ${'x'.repeat(limit)} ` }),
        field,
      ).toEqual({})
      expect(
        propertyContacts.personProblems({ ...person, [field]: 'x'.repeat(limit + 1) }),
        field,
      ).toEqual({ [field]: `${subjects[field]} hat höchstens ${String(limit)} Zeichen.` })
    }
  })

  it('names every text that is too long, in the order a form asks for them', () => {
    expect(
      Object.entries(
        propertyContacts.personProblems({
          phone: 'x'.repeat(contactLimits.phone + 1),
          familyName: 'x'.repeat(contactLimits.familyName + 1),
          role: 'x'.repeat(contactLimits.role + 1),
        }),
      ),
    ).toEqual([
      ['familyName', 'Der Nachname hat höchstens 80 Zeichen.'],
      ['role', 'Die Funktion hat höchstens 80 Zeichen.'],
      ['phone', 'Die Telefonnummer hat höchstens 40 Zeichen.'],
    ])
  })

  it('is not also told that a missing family name is too long', () => {
    // What is no text has no length: the sentence of the foundation is the whole answer.
    expect(propertyContacts.personProblems({ familyName: 4471 })).toEqual({
      familyName: 'Der Nachname fehlt.',
    })
  })

  it('leaves a text alone that a change does not name', () => {
    expect(propertyContacts.personProblems({ phone: '0000 4471' })).toEqual({})
    expect(propertyContacts.personProblems({})).toEqual({})
  })
})
