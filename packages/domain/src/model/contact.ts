import { type ContactPerson, contactRules, type ContactTexts } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { ContractorId } from './contractor.js'
import { optional, type Problems } from './fields.js'
import type { PropertyId } from './location.js'

/**
 * A person to talk to at a property (section 4.1 of the concept): the
 * caretaker, the head of a school, whoever knows where the key is; or at a
 * contractor of the operator (section 4.11, #328): whoever takes the call
 * there.
 *
 * Who a contact is and how to reach them is the foundation's (ADR 0010 of the
 * repository opengewerk); what one hangs on here is a property or a
 * contractor, exactly one. At a property its area is the area of the
 * property, like that of every row with a place (ADR 0003); at a contractor
 * it has none, as the contractor has none (addendum of #328).
 */
export interface Contact extends ContactPerson {
  readonly propertyId: PropertyId | null
  readonly areaId: AreaId | null
  readonly contractorId: ContractorId | null
}

/** The bounds of the texts of a contact, the same in the form, the route and the database. */
export const contactLimits = {
  givenName: 80,
  familyName: 80,
  role: 80,
  phone: 40,
  mobile: 40,
  email: 254,
} as const

/** What a field of a contact is called where a sentence names it. */
const subjects = {
  givenName: 'Der Vorname',
  familyName: 'Der Nachname',
  role: 'Die Funktion',
  phone: 'Die Telefonnummer',
  mobile: 'Die Mobilnummer',
  email: 'Die E-Mail-Adresse',
} as const

/**
 * What this application finds wrong with the texts of a contact beside the
 * rule every contact has: each is no longer than the database keeps it. That
 * a contact has a family name at all the foundation asks, and says first.
 */
function tooLong(texts: ContactTexts): Readonly<Problems> {
  const problems: Problems = {}

  for (const field of Object.keys(contactLimits) as (keyof typeof contactLimits)[]) {
    optional(
      problems,
      texts,
      field,
      contactLimits[field],
      `${subjects[field]} hat höchstens ${String(contactLimits[field])} Zeichen.`,
    )
  }

  return problems
}

/**
 * The rules of the contacts of this application, as the foundation makes them:
 * one object for the form, the route and the sync. A contact hangs on a
 * property or on a contractor, exactly one of the two.
 */
export const operatorContacts = contactRules({
  parents: ['propertyId', 'contractorId'],
  parentText: {
    none: 'Ein Ansprechpartner gehört zu einer Liegenschaft oder einer Fremdfirma, dieser zu keiner.',
    several:
      'Ein Ansprechpartner gehört zu einer Liegenschaft oder einer Fremdfirma, nicht zu beiden.',
  },
  problems: tooLong,
})
