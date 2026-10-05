import { type ContactPerson, contactRules, type ContactTexts } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import { optional, type Problems } from './fields.js'
import type { PropertyId } from './location.js'

/**
 * A person to talk to at a property (section 4.1 of the concept): the
 * caretaker, the head of a school, whoever knows where the key is.
 *
 * Who a contact is and how to reach them is the foundation's (ADR 0010 of the
 * repository opengewerk); what one hangs on here is the property, and nothing
 * else. Its area is the area of its property, like that of every row with a
 * place (ADR 0003).
 */
export interface Contact extends ContactPerson {
  readonly propertyId: PropertyId
  readonly areaId: AreaId
}

/** The bounds of the texts of a contact, the same in the form, the route and the database. */
export const contactLimits = {
  givenName: 80,
  familyName: 80,
  role: 80,
  phone: 40,
  email: 254,
} as const

/** What a field of a contact is called where a sentence names it. */
const subjects = {
  givenName: 'Der Vorname',
  familyName: 'Der Nachname',
  role: 'Die Funktion',
  phone: 'Die Telefonnummer',
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
 * property, the one parent there is, so "several" cannot happen and has its
 * sentence only because the rules ask for one.
 */
export const propertyContacts = contactRules({
  parents: ['propertyId'],
  parentText: {
    none: 'Ein Ansprechpartner gehört zu einer Liegenschaft, dieser zu keiner.',
    several: 'Ein Ansprechpartner gehört zu genau einer Liegenschaft.',
  },
  problems: tooLong,
})
