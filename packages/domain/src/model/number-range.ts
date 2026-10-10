/**
 * Which counter a number is drawn from.
 *
 * Three things carry a number of this application, each from a sequence of
 * its own, because each is counted for a different reason. They are the three
 * the concept names for the foundation (section 12, phase 0).
 *
 * - `asset`: the number of an asset is handed out once and never again, not
 *   even after the asset is gone (ADR 0002, point 8). An asset made on a
 *   device without a connection gets it from the server when it arrives.
 * - `work_order`: what the people who report a fault, hand out the work and
 *   do it name a work order by (section 4.8 of the concept; ADR 0002,
 *   point 13). Of the kinds of activity it is the only one with a number.
 * - `evidence`: a piece of evidence gets its number when it is fixed, on the
 *   server and never on a device (ADR 0004, point 10), so that the numbers
 *   run without holes in the order the evidence came to be.
 *
 * How a number is drawn without holes, how a pattern is written and what a
 * counter becomes in it is the foundation's (`numberRangeStore`,
 * `patternProblem`, `numberFromPattern`). What this application says is which
 * sequences there are, and the pattern each one starts with
 * (`defaultNumberPatterns`).
 *
 * The list is the list in the database, in the same order: a further sequence
 * is a further entry here and a migration that adds it there.
 */
export const numberRangeKeys = ['asset', 'work_order', 'evidence'] as const

export type NumberRangeKey = (typeof numberRangeKeys)[number]

/**
 * What each sequence is called where a person reads it, by what it numbers:
 * the change log names a sequence so (#176), and not by its key.
 */
export const numberRangeLabel: Readonly<Record<NumberRangeKey, string>> = {
  asset: 'Anlagen',
  work_order: 'Aufträge',
  evidence: 'Nachweise',
}

/**
 * The pattern each sequence starts with, until a tenant sets its own. The
 * foundation asks for one for every sequence when the store is made, so all
 * three are named here, with the asset (#20): the asset number has no year,
 * because an asset outlives many, and a work order and a piece of evidence
 * carry the year they were made in, like the jobs of the Handwerkersoftware.
 */
export const defaultNumberPatterns: Readonly<Record<NumberRangeKey, string>> = {
  asset: 'AN-{number:5}',
  work_order: 'AU-{year}-{number:4}',
  evidence: 'NW-{year}-{number:5}',
}
