/**
 * Names in the order a German list sorts them, a number in a name by its
 * value: Musterstraße 2, 2.1, 3, 10, room E.2 before E.10, Anlage 9 before
 * Anlage 10 (#322). Compared as text, 10 stands before 2, because the first
 * digit decides.
 *
 * Every list of names takes this, in the interface and on the server alike, so
 * that the office, the telephone and a route agree on one order. A lint rule
 * keeps `localeCompare(…, 'de')` from coming back.
 */
const inGerman = new Intl.Collator('de', { numeric: true })

/** Two names in the order a German list sorts them, a number in them by its value. */
export function byNameIn(left: string, right: string): number {
  return inGerman.compare(left, right)
}

/** What a room or an asset is counted by: its number, and its name beside it. */
export interface Numbered {
  readonly number: string | null
  readonly name: string | null
}

/**
 * Rooms and assets by their number as a person counts them, E.2 before E.10
 * and AN-00009 before AN-00010, two with the same number by name. Those
 * without a number come after them, by name: a room that has only a name,
 * and an asset the server has not numbered yet.
 */
export function byNumberIn(left: Numbered, right: Numbered): number {
  const byName = () => byNameIn(left.name ?? '', right.name ?? '')

  if (left.number === null || right.number === null) {
    return left.number === right.number ? byName() : left.number === null ? 1 : -1
  }

  return byNameIn(left.number, right.number) || byName()
}
