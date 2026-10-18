import type { Id, IsoDate, Synced } from '@opengewerk/platform-domain'

import type { EvidenceResult } from './evidence.js'
import { optional, type Problems, required } from './fields.js'

/**
 * A contractor of the operator (section 4.11 of the concept, #328): a firm
 * that carries out duties, with its address, the cost groups it works in and
 * a note. Tenant-wide and without an area (2.8): every role sees the
 * contractors, the Leitung and the Technische Leitung keep them.
 *
 * A duty and an activity name the firm out of this list. Evidence keeps the
 * organisation as it was written, frozen like everything else in it (2.6),
 * and names the firm beside it where its report came from one. A firm that
 * no longer works for the operator is marked removed (`deletedAt`), out of
 * every choice and readable wherever it is named; it cannot be removed while an open duty names it.
 */
export type ContractorId = Id<'contractor'>

export interface Contractor extends Synced {
  readonly id: ContractorId
  readonly name: string
  readonly street: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly phone: string | null
  readonly email: string | null
  /** The cost groups the firm works in, of the second level, "440". */
  readonly services: readonly string[]
  readonly note: string | null
}

/** The bounds of the texts of a contractor, the same in the form, the route and the database. */
export const contractorLimits = {
  name: 120,
  street: 120,
  postalCode: 10,
  city: 80,
  phone: 40,
  email: 254,
  note: 500,
  /** The people to talk to a firm is made with at once (#383); more come on its page. */
  contacts: 10,
} as const

/**
 * The cost groups a contractor may work in (decided 15.10.2026): those of
 * the second level of the technical installations, 410 to 490, and the
 * portable electrical equipment, 610, which the catalogue keeps as a group
 * of its own.
 */
export const contractorServices = [
  '410',
  '420',
  '430',
  '440',
  '450',
  '460',
  '470',
  '480',
  '490',
  '610',
] as const

/** The texts of a contractor besides its name, with the sentence for each that is too long. */
const optionalTexts = [
  ['street', 'Die Straße'],
  ['postalCode', 'Die Postleitzahl'],
  ['city', 'Der Ort'],
  ['phone', 'Die Telefonnummer'],
  ['email', 'Die E-Mail-Adresse'],
  ['note', 'Die Notiz'],
] as const

/**
 * What is wrong with a contractor, one sentence per field, empty when
 * nothing is. Undefined is a field that was not given, as in a change of
 * other fields.
 */
export function contractorProblems(
  contractor: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, contractor, 'name', contractorLimits.name, 'Der Name')

  for (const [field, subject] of optionalTexts) {
    const most = contractorLimits[field]

    optional(problems, contractor, field, most, `${subject} hat höchstens ${String(most)} Zeichen.`)
  }

  const services = contractor['services']

  if (
    services !== undefined &&
    (!Array.isArray(services) ||
      services.some((service) => !(contractorServices as readonly unknown[]).includes(service)) ||
      new Set(services).size !== services.length)
  ) {
    problems['services'] =
      'Eine Leistung ist eine Kostengruppe von 410 bis 490 oder 610, jede einmal.'
  }

  return problems
}

/** "KG 440, KG 450": the services of a firm in the words of a list, in the order of the groups. */
export function contractorServicesWords(services: readonly string[]): string {
  return [...services]
    .sort()
    .map((service) => `KG ${service}`)
    .join(', ')
}

/** A contractor in the list of the office, with how many open duties name it. */
export interface ContractorEntry extends Contractor {
  readonly openDuties: number
}

/** An evidence of a report of the firm, as its page lists it: the organisation as it was written. */
export interface ContractorEvidence {
  readonly id: string
  readonly number: string
  readonly dutyTitle: string
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  readonly examinerOrganisation: string | null
}

/** The page of a contractor: the firm, its open duties counted, and the evidence of its reports, newest first. */
export interface ContractorPage {
  readonly contractor: Contractor
  readonly openDuties: number
  readonly openActivities: number
  readonly evidence: readonly ContractorEvidence[]
}

/**
 * A name that stands as text at duties a contractor performs, which the
 * office is offered to take over (decided 15.10.2026): how many duties bear
 * it, and the live firm of the list with the same name where there is one.
 */
export interface ContractorName {
  readonly name: string
  readonly duties: number
  readonly contractorId: ContractorId | null
}

/** The most names one take-over names, and the most evidence the page of a firm lists. */
export const contractorBounds = { takeover: 200, evidence: 20, visits: 50 } as const

/** Whether two names of a firm are the same, as a person reads them: case and spaces aside. */
export function sameFirmName(left: string, right: string): boolean {
  const plain = (name: string) => name.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('de')

  return plain(left) === plain(right)
}
