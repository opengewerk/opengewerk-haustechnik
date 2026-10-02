import { numberRangeKeys } from '@opengewerk/haustechnik-domain'
import { numberRangesSchema } from '@opengewerk/platform-server'

/**
 * The counters of the numbers that run without holes: one row per tenant and
 * sequence, for assets, work orders and evidence.
 *
 * The table is the foundation's (`numberRangesSchema`), which is where its
 * columns and the reason for a counter in a row are described. What this
 * application says is which sequences there are, and that list lives in
 * `domain`, where the interface reads it as well.
 */
export const { numberRangeKey, numberRanges } = numberRangesSchema(numberRangeKeys)
