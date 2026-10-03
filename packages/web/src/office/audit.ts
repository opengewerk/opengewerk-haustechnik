import { auditVocabulary } from '@opengewerk/haustechnik-domain'
import type { AuditScreenWords } from '@opengewerk/platform-web/office'

/**
 * The change log of a tenant in the words of this application, as the screen
 * of the foundation reads it (ADR 0010 in the repository opengewerk): the
 * vocabulary its server is told as well. The tables of this application have
 * no values of their own to put into words yet and no screens to open a
 * record on; each that gets one adds its words and its way here.
 */
export const auditScreenWords: AuditScreenWords = { vocabulary: auditVocabulary }
