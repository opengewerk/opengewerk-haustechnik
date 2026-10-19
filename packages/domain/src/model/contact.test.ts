import { contactTextFields } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { contactLimits, operatorContacts } from './contact.js'

const subjects = {
  givenName: 'Der Vorname',
  familyName: 'Der Nachname',
  role: 'Die Funktion',
  phone: 'Die Telefonnummer',
  mobile: 'Die Mobilnummer',
  email: 'Die E-Mail-Adresse',
} as const

describe('somebody to talk to at a property', () => {
  it('hangs on a property or on a contractor (#328), exactly one of the two', () => {
    expect(operatorContacts.parents).toEqual(['propertyId', 'contractorId'])
    expect(operatorContacts.parentProblem({ propertyId: 'a-property' })).toBeNull()
    expect(operatorContacts.parentOf({ propertyId: 'a-property' })).toEqual({
      field: 'propertyId',
      id: 'a-property',
    })
    expect(operatorContacts.parentOf({ propertyId: null, contractorId: 'a-firm' })).toEqual({
      field: 'contractorId',
      id: 'a-firm',
    })
    expect(
      operatorContacts.parentProblem({ propertyId: 'a-property', contractorId: 'a-firm' }),
    ).toBe('several')
    expect(operatorContacts.parentText.several).toBe(
      'Ein Ansprechpartner gehört zu einer Liegenschaft oder einer Fremdfirma, nicht zu beiden.',
    )
  })

  it('is told in a sentence that it belongs to a property or a contractor when it names none', () => {
    for (const none of [{}, { propertyId: null }, { propertyId: '', contractorId: null }]) {
      expect(operatorContacts.parentProblem(none)).toBe('none')
      expect(operatorContacts.parentOf(none)).toBeNull()
    }

    expect(operatorContacts.parentText.none).toBe(
      'Ein Ansprechpartner gehört zu einer Liegenschaft oder einer Fremdfirma, dieser zu keiner.',
    )
  })

  it('needs a family name and nothing else', () => {
    expect(operatorContacts.personProblems({ familyName: 'Becker' })).toEqual({})
    expect(
      operatorContacts.personProblems({
        givenName: null,
        familyName: 'Becker',
        role: null,
        phone: null,
        email: null,
      }),
    ).toEqual({})
    expect(operatorContacts.personProblems({ givenName: 'Jens', familyName: ' ' })).toEqual({
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
        operatorContacts.personProblems({ ...person, [field]: ` ${'x'.repeat(limit)} ` }),
        field,
      ).toEqual({})
      expect(
        operatorContacts.personProblems({ ...person, [field]: 'x'.repeat(limit + 1) }),
        field,
      ).toEqual({ [field]: `${subjects[field]} hat höchstens ${String(limit)} Zeichen.` })
    }
  })

  it('names every text that is too long, in the order a form asks for them', () => {
    expect(
      Object.entries(
        operatorContacts.personProblems({
          mobile: 'x'.repeat(contactLimits.mobile + 1),
          phone: 'x'.repeat(contactLimits.phone + 1),
          familyName: 'x'.repeat(contactLimits.familyName + 1),
          role: 'x'.repeat(contactLimits.role + 1),
        }),
      ),
    ).toEqual([
      ['familyName', 'Der Nachname hat höchstens 80 Zeichen.'],
      ['role', 'Die Funktion hat höchstens 80 Zeichen.'],
      ['phone', 'Die Telefonnummer hat höchstens 40 Zeichen.'],
      ['mobile', 'Die Mobilnummer hat höchstens 40 Zeichen.'],
    ])
  })

  it('is not also told that a missing family name is too long', () => {
    // What is no text has no length: the sentence of the foundation is the whole answer.
    expect(operatorContacts.personProblems({ familyName: 4471 })).toEqual({
      familyName: 'Der Nachname fehlt.',
    })
  })

  it('leaves a text alone that a change does not name', () => {
    expect(operatorContacts.personProblems({ phone: '0000 4471' })).toEqual({})
    expect(operatorContacts.personProblems({})).toEqual({})
  })
})
