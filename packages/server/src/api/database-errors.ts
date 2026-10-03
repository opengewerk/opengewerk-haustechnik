import { databaseErrors } from '@opengewerk/platform-server'

/**
 * The translation of a refusal of the database into an answer is the
 * foundation's (ADR 0010 in the repository opengewerk): a policy that refuses
 * becomes a 403 that says nothing about whether the row exists elsewhere, a
 * value that does not fit the data model a 400, and what the foundation's own
 * functions raise a 409 with their sentence.
 *
 * The error classes of this application go the same way, each with the
 * sentence that stands in when the database gave none. The class is `HT`
 * followed by three digits, beside the foundation's `OG`.
 */
export const applicationConflicts: Readonly<Record<string, string>> = {
  // A component under itself, however long the chain (#20).
  HT001: 'Eine Komponente hängt nicht unter sich selbst.',
  // An asset moved to another property (#20).
  HT002:
    'Eine Anlage bleibt auf ihrer Liegenschaft; an einem anderen Ort ist sie eine neue Anlage.',
}

export const { answerFor, DatabaseExceptionFilter } = databaseErrors(applicationConflicts)
