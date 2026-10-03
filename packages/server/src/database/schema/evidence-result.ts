import { evidenceResults } from '@opengewerk/haustechnik-domain'
import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * The result of a performance, from the list in `domain`: what an evidence
 * says and what the duties of an activity carry while it is performed.
 */
export const evidenceResult = pgEnum('evidence_result', evidenceResults)
