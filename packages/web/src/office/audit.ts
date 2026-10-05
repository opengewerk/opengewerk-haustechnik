import { auditVocabulary, ruleScopeNames } from '@opengewerk/haustechnik-domain'
import type { AuditScreenWords } from '@opengewerk/platform-web/office'

/**
 * The change log of a tenant in the words of this application, as the screen
 * of the foundation reads it (ADR 0010 in the repository opengewerk): the
 * vocabulary its server is told as well, how the values of its fields are
 * written, and where a record is opened. Each table that gets values of its
 * own or a screen adds its words and its way here.
 */

type Words = Readonly<Record<string, string>>

/** Where a record is opened in the office, for the records that have a screen. */
const screens: Words = {
  properties: '/liegenschaften/',
}

/** The label of the link to a record. */
const links: Words = {
  properties: 'Zur Liegenschaft',
}

export const auditScreenWords: AuditScreenWords = {
  vocabulary: auditVocabulary,
  values: {
    // The log holds `DE-BW`, the Leitung reads "Baden-Württemberg".
    properties: { federal_state: ruleScopeNames },
  },
  href: (table, id) => {
    const start = Object.hasOwn(screens, table) ? screens[table] : undefined

    return start ? `${start}${id}` : null
  },
  linkWords: (table) => (Object.hasOwn(links, table) ? (links[table] ?? null) : null),
}
