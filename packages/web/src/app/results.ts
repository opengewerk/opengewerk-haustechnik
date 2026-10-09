import type { EvidenceResult } from '@opengewerk/haustechnik-domain'

/**
 * What picking a result means, under its name (section 4.4 of the concept):
 * the same sentences in the office, where a report is entered (#110), and on
 * site, where a protocol is signed (#108).
 */
export const resultNotes = {
  without_defects: undefined,
  with_defects: 'Die Pflicht ist erfüllt, die Mängel werden geführt.',
  failed: 'Die Pflicht bleibt offen, bis eine Prüfung bestanden ist.',
  not_performed: 'Mit Grund. Am Termin ändert sich nichts.',
} as const satisfies Readonly<Record<EvidenceResult, string | undefined>>

/** The results in the order they are offered. */
export const offeredResults = [
  'without_defects',
  'with_defects',
  'failed',
  'not_performed',
] as const satisfies readonly EvidenceResult[]
