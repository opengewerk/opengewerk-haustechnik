import { isGeneralKind } from './asset-duplicate.js'
import type { AssetKind, CatalogueEntry } from './catalogue.js'

/**
 * The cost groups of DIN 276 as far as the register of assets needs them: an
 * asset kind names the group of its assets with three digits (ADR 0002,
 * point 9), and a building is read by the groups one level above, 410 to
 * 490, the technical installations of a building.
 *
 * A group is its number here and nothing else. What DIN 276 heads a group
 * with stands nowhere in the application: a private norm is referred to and
 * said in words of one's own (section 5 of the concept, #163).
 */

/** The group of the second level a cost group lies in: 461 lies in 460, and 460 in itself. */
export function costGroupAbove(costGroup: string): string {
  return `${costGroup.slice(0, 2)}0`
}

/**
 * A cost group without the zeros it ends in: "46" of 460, "4" of 400. Counted
 * by hand and not with a pattern: the group may come out of an address, and a
 * pattern for "zeros at the end" takes quadratic time on a long text of them.
 */
function stemOf(group: string): string {
  let end = group.length

  while (end > 0 && group[end - 1] === '0') {
    end -= 1
  }

  return group.slice(0, end)
}

/**
 * Whether a cost group lies in another. A group whose number ends in zeros
 * holds every group that begins like it, 460 the groups 461 to 469 and 400
 * every group of the technical installations; any other holds itself alone.
 */
export function inCostGroup(costGroup: string, group: string): boolean {
  const stem = stemOf(group)

  return stem !== '' && costGroup.startsWith(stem)
}

/**
 * What a cost group goes by beside its number: the label of the general asset
 * kind of exactly this group, the words the package Allgemein has for an asset
 * of the group that no package describes more closely (section 4.2). Null for
 * a group no general kind stands for, 461 or one outside the technical
 * installations, and on a device whose catalogue has no such kind.
 */
export function costGroupName(
  group: string,
  kinds: readonly CatalogueEntry<AssetKind>[],
): string | null {
  return (
    kinds.find((kind) => isGeneralKind(kind.key) && kind.definition.costGroup === group)?.definition
      .label ?? null
  )
}

/** "KG 460 Förderanlage", and "KG 461" for a group that goes by its number alone. */
export function costGroupWords(group: string, kinds: readonly CatalogueEntry<AssetKind>[]): string {
  const name = costGroupName(group, kinds)

  return name === null ? `KG ${group}` : `KG ${group} ${name}`
}
