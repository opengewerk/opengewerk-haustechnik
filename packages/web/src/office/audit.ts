import {
  auditValueWords,
  auditValueWordsWith,
  auditVocabulary,
  type Catalogue,
} from '@opengewerk/haustechnik-domain'
import type { AuditScreenWords } from '@opengewerk/platform-web/office'

import { activityPlaces } from './activity-addresses.js'
import { contractPlaces } from './contract-addresses.js'
import { contractorPlaces } from './contractor-addresses.js'
import { defectPlaces } from './defect-addresses.js'
import { documentPlaces } from './document-addresses.js'
import { faultPlaces } from './fault-addresses.js'
import { dutyPlaces, evidencePlaces } from './duty-addresses.js'
import { importPage } from './import-addresses.js'
import { ImportOriginLead } from './import-origin.js'
import { officePlaces } from './place-addresses.js'
import { planPlaces, templatePlaces } from './round-template-addresses.js'

/**
 * The change log of a tenant in the words of this application, as the screen
 * of the foundation reads it (ADR 0010 in the repository opengewerk): the
 * vocabulary its server is told as well, how the values of its fields are
 * written (`auditValues` of `domain`, beside the vocabulary), and where a
 * record is opened. Each table that gets a screen adds its way here.
 */

type Words = Readonly<Record<string, string>>

/** Where a record is opened in the office, for the records that have a screen. */
const screens: Readonly<Record<string, (id: string) => string>> = {
  properties: officePlaces.property,
  buildings: officePlaces.building,
  floors: officePlaces.floor,
  rooms: officePlaces.room,
  assets: officePlaces.asset,
  duties: dutyPlaces.duty,
  evidence: evidencePlaces.evidence,
  attachments: documentPlaces.document,
  activities: activityPlaces.activity,
  defects: defectPlaces.defect,
  round_templates: templatePlaces.template,
  round_plans: planPlaces.plan,
  contractors: contractorPlaces.contractor,
  contracts: contractPlaces.contract,
  fault_reports: faultPlaces.report,
  // An import is one entry of the log, and its page lists what it made (#174).
  imports: importPage,
}

/** The label of the link to a record. */
const links: Words = {
  properties: 'Zur Liegenschaft',
  buildings: 'Zum Gebäude',
  floors: 'Zum Geschoss',
  rooms: 'Zum Raum',
  assets: 'Zur Anlage',
  duties: 'Zur Pflicht',
  evidence: 'Zum Nachweis',
  attachments: 'Zum Dokument',
  activities: 'Zum Vorgang',
  defects: 'Zum Mangel',
  round_templates: 'Zur Vorlage',
  round_plans: 'Zum Plan',
  contractors: 'Zur Fremdfirma',
  contracts: 'Zum Vertrag',
  fault_reports: 'Zur Störmeldung',
  imports: 'Zum Import',
}

export const auditScreenWords: AuditScreenWords = {
  vocabulary: auditVocabulary,
  // Every value of a list in the words the office reads elsewhere, held
  // against the columns of the database by a test of the server (#80), and
  // the kinds of a building; the server writes the log as a table with the
  // same words (#236).
  ...auditValueWords,
  href: (table, id) => {
    const page = Object.hasOwn(screens, table) ? screens[table] : undefined

    return page ? page(id) : null
  },
  linkWords: (table) => (Object.hasOwn(links, table) ? (links[table] ?? null) : null),
  // Beside the chip of a record's log: what the log takes in with the record
  // (`parts` of the vocabulary).
  partsWords: {
    properties: 'mit ihren Ansprechpartnern',
    buildings: 'mit seinen Schließzeiten',
    rooms: 'mit seinen Etiketten',
    assets:
      'mit ihrem Lebenszyklus, dem, was sie versorgt, ihren Etiketten und bei einem Zähler seinen Ständen',
    attachments: 'mit seinen Fassungen',
    activities:
      'mit den Pflichten, die er erfüllen soll, den Antworten auf sein Formular und bei einem Auftrag dessen Angaben und Beteiligten',
    defects: 'mit seinen Fotos',
    round_templates: 'mit ihren Fassungen',
  },
  // Over the log of a record an import made, the import (#174): no change says so.
  lead: ImportOriginLead,
}

/**
 * The same words with the catalogue of this device at hand (#245): a duty
 * from the catalogue, which has no name of its own, is named by its kind,
 * and a field that holds a key of the catalogue says what the key is called,
 * as the server writes it into the log as a table. Without a catalogue, on a
 * device that has not fetched one yet, the words above, and the keys stay
 * until it has.
 */
export function auditScreenWordsWith(catalogue: Catalogue | null): AuditScreenWords {
  return catalogue === null
    ? auditScreenWords
    : { ...auditScreenWords, ...auditValueWordsWith(catalogue) }
}
