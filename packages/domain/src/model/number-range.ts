/**
 * Which counter a number is drawn from.
 *
 * Two things carry a number of this application, each from a sequence of its
 * own, because each is counted for a different reason.
 *
 * - `asset`: the number of an asset is handed out once and never again, not
 *   even after the asset is gone (ADR 0002, point 8). An asset made on a
 *   device without a connection gets it from the server when it arrives.
 * - `evidence`: a piece of evidence gets its number when it is fixed, on the
 *   server and never on a device (ADR 0004, point 10), so that the numbers
 *   run without holes in the order the evidence came to be.
 *
 * How a number is drawn without holes, how a pattern is written and what a
 * counter becomes in it is the foundation's (`numberRangeStore`,
 * `patternProblem`, `numberFromPattern`). What this application says is which
 * sequences there are. The pattern each one starts with is named where its
 * first number is drawn, with the asset and with the evidence.
 *
 * The list is the list in the database: a further sequence is a further entry
 * here and a migration that adds it there.
 */
export const numberRangeKeys = ['asset', 'evidence'] as const

export type NumberRangeKey = (typeof numberRangeKeys)[number]
