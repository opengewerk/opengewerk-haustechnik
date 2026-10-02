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
 * sequences there are. The pattern each one starts with is named where its
 * first number is drawn, with the asset, the work order and the evidence.
 *
 * The list is the list in the database, in the same order: a further sequence
 * is a further entry here and a migration that adds it there.
 */
export const numberRangeKeys = ['asset', 'work_order', 'evidence'] as const

export type NumberRangeKey = (typeof numberRangeKeys)[number]
