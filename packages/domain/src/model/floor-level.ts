import { wholeNumberOfCell } from '@opengewerk/platform-domain'

/**
 * The level of a floor read from what a list calls it, or null where the name
 * does not say (#100).
 *
 * A floor has a level, a whole number with the ground floor at 0, and a list
 * somebody kept has "EG" and "1. OG". Read are the names that say a number
 * beyond doubt: the ground floor, an upper floor and a basement with or
 * without their count, a storey with its count, and a bare number.
 * Everything else is not guessed. An attic is the top floor of a building
 * this function knows nothing about, a mezzanine lies between two levels and
 * an underground car park under whatever is above it; whoever imports them
 * gives the level a column.
 */
export function levelOfFloorName(name: string): number | null {
  // A stop or a comma between two figures is a fraction or a numbering of its
  // own ("1.5", "E 1.5"), and neither is a level.
  if (/\d[.,]\d/.test(name)) {
    return null
  }

  const plain = name
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[\s._]+/g, '')
  const bare = wholeNumberOfCell(plain)

  if (bare !== null) {
    return bare
  }

  if (ground.has(plain)) {
    return 0
  }

  const numbered = /^(?:e|ebene)(-?\d{1,3})$/.exec(plain)

  if (numbered) {
    // "E-0" is the ground floor and not a zero with a sign.
    return Number(numbered[1]) || 0
  }

  const below = /^u(\d{1,3})$/.exec(plain)

  if (below) {
    return Number(below[1]) === 0 ? null : -Number(below[1])
  }

  for (const { word, sign, alone } of storeys) {
    if (plain === word) {
      return alone ? sign : null
    }

    const count =
      new RegExp(`^(\\d{1,3})${word}$`).exec(plain) ?? new RegExp(`^${word}(\\d{1,3})$`).exec(plain)

    if (count) {
      // No floor above or below the ground is its number 0.
      return Number(count[1]) === 0 ? null : sign * Number(count[1])
    }
  }

  return null
}

const ground = new Set(['eg', 'erdgeschoss', 'parterre'])

/**
 * The words for a floor above or below the ground. `alone` says whether the
 * word without a count names the first of them: "OG" and "Keller" do,
 * "Etage" and "Stockwerk" name no floor until a number stands with them.
 * A word is only read where it is the whole name beside its count, so that
 * no name is read that merely holds one.
 */
const storeys = [
  { word: 'obergeschoss', sign: 1, alone: true },
  { word: 'og', sign: 1, alone: true },
  { word: 'stockwerk', sign: 1, alone: false },
  { word: 'stock', sign: 1, alone: false },
  { word: 'etage', sign: 1, alone: false },
  { word: 'untergeschoss', sign: -1, alone: true },
  { word: 'kellergeschoss', sign: -1, alone: true },
  { word: 'keller', sign: -1, alone: true },
  { word: 'ug', sign: -1, alone: true },
  { word: 'kg', sign: -1, alone: true },
] as const
