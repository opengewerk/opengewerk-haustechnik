import { databaseErrors } from '@opengewerk/platform-server'

/**
 * The translation of a refusal of the database into an answer is the
 * foundation's (ADR 0010 in the repository opengewerk): a policy that refuses
 * becomes a 403 that says nothing about whether the row exists elsewhere, a
 * value that does not fit the data model a 400, and what the foundation's own
 * functions raise a 409 with their sentence.
 *
 * This application has no error class of its own yet. The first trigger that
 * raises one, the one that keeps evidence from being changed, enters its code
 * here with the sentence that stands in when the database gave none.
 */
export const { answerFor, DatabaseExceptionFilter } = databaseErrors()
