import { roomTitle } from '@opengewerk/haustechnik-domain'
import type { Asset, Building, Floor, Property, Room } from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * What a page at a place stands under, from the property down. A page of a
 * building names its property, a page of an asset in a room names all four,
 * and what hangs on an asset (a component, a duty, a defect) names the asset
 * as well. The page itself is no step: it is the title under the path (4.1
 * of the concept).
 */
export interface PlaceAbove {
  readonly property: Pick<Property, 'id' | 'name'>
  readonly building?: Pick<Building, 'id' | 'name'>
  readonly floor?: Pick<Floor, 'id' | 'name'>
  readonly room?: Pick<Room, 'id' | 'number' | 'name'>
  readonly asset?: Pick<Asset, 'id' | 'name'>
}

/**
 * Where the page of a place lives in one entry. The office and the entry on
 * site are two documents with addresses of their own, so each says its own;
 * the words of the path are said here, once for both.
 */
export interface PlaceAddresses {
  /**
   * The list a path starts from, in an entry that has one: the office starts
   * at "Liegenschaften", the entry on site at the property itself.
   */
  readonly list?: Crumb
  readonly property: (id: Property['id']) => string
  readonly building: (id: Building['id']) => string
  readonly floor: (id: Floor['id']) => string
  readonly room: (id: Room['id']) => string
  readonly asset: (id: Asset['id']) => string
}

/**
 * The path over a page at a place: property, building, floor, room and
 * asset, as far as the page stands under them, each a step that leads to its
 * own page.
 *
 * "Auf jedem Gerät gleich" (4.1): the office draws these steps with `Crumbs`
 * and the entry on site with `SiteCrumbs`, and both get them from here, so
 * the same page stands under the same words wherever it is opened.
 */
export function placePath(above: PlaceAbove, addresses: PlaceAddresses): readonly Crumb[] {
  const { property, building, floor, room, asset } = above

  return [
    ...(addresses.list ? [addresses.list] : []),
    { to: addresses.property(property.id), label: property.name },
    ...(building ? [{ to: addresses.building(building.id), label: building.name }] : []),
    ...(floor ? [{ to: addresses.floor(floor.id), label: floor.name }] : []),
    ...(room ? [{ to: addresses.room(room.id), label: roomTitle(room) }] : []),
    ...(asset ? [{ to: addresses.asset(asset.id), label: asset.name }] : []),
  ]
}
