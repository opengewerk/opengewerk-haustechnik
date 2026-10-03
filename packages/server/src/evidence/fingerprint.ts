import { createHash } from 'node:crypto'

import { canonicalForm, type StoredEvidenceState } from '@opengewerk/haustechnik-domain'

/**
 * The fingerprint of a frozen state (ADR 0004, point 6): SHA-256 over its
 * canonical form, as 64 hexadecimal digits. It stands on the row of the
 * evidence and with it in the log, and it is worked out the same way when the
 * evidence is written down and whenever it is checked.
 */
export function stateFingerprint(state: StoredEvidenceState | object): string {
  return createHash('sha256').update(canonicalForm(state), 'utf8').digest('hex')
}

/**
 * Whether an evidence still carries the fingerprint of its state: the check
 * that works it out again from what the row holds (ADR 0004, point 6). The
 * trigger refuses every change, so this is false only after a change that
 * went past the database, which the chain of the log shows as well.
 */
export function evidenceIntact(row: {
  readonly state: StoredEvidenceState
  readonly fingerprint: string
}): boolean {
  return stateFingerprint(row.state) === row.fingerprint
}
