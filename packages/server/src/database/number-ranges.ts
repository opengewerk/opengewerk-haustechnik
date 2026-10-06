import { defaultNumberPatterns, numberRangeKeys } from '@opengewerk/haustechnik-domain'
import { numberRangeStore } from '@opengewerk/platform-server'

import { yearInGermany } from '../today.js'
import { numberRanges } from './schema/index.js'

/**
 * The numbers of a tenant, drawn inside the transaction that creates what
 * carries them. How a number is drawn without holes is the foundation's
 * (`numberRangeStore`, ADR 0010 in the repository opengewerk); this binds it
 * to the sequences of this application, the pattern each starts with, both
 * from `domain`, and the year as it is in Germany.
 */
export const { assignNumber, assignNumbers, numberRangesOf, changeNumberRange } = numberRangeStore(
  numberRanges,
  {
    keys: numberRangeKeys,
    defaultPatterns: defaultNumberPatterns,
    yearOf: yearInGermany,
  },
)
