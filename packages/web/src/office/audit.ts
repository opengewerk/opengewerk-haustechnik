import { auditVocabulary, buildingKindLabel, ruleScopeNames } from '@opengewerk/haustechnik-domain'
import type { AuditScreenWords } from '@opengewerk/platform-web/office'

import { activityPlaces } from './activity-addresses.js'
import { defectPlaces } from './defect-addresses.js'
import { documentPlaces } from './document-addresses.js'
import { dutyPlaces, evidencePlaces } from './duty-addresses.js'
import { officePlaces } from './place-addresses.js'

/**
 * The change log of a tenant in the words of this application, as the screen
 * of the foundation reads it (ADR 0010 in the repository opengewerk): the
 * vocabulary its server is told as well, how the values of its fields are
 * written, and where a record is opened. Each table that gets values of its
 * own or a screen adds its words and its way here.
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
}

export const auditScreenWords: AuditScreenWords = {
  vocabulary: auditVocabulary,
  values: {
    // The log holds `DE-BW`, the Leitung reads "Baden-Württemberg".
    properties: { federal_state: ruleScopeNames },
  },
  // The log holds the kinds of a building as `school`, the Leitung reads
  // "Schule oder Hochschule".
  lists: { kinds: buildingKindLabel },
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
    assets: 'mit ihrem Lebenszyklus, dem, was sie versorgt, und ihren Etiketten',
    attachments: 'mit seinen Fassungen',
    activities: 'mit den Pflichten, die er erfüllen soll',
    defects: 'mit seinen Fotos',
  },
}
