import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'

/**
 * What a record hangs on that belongs to a place (ADR 0002, point 10): the
 * property always, and at most one of a building, a room or an asset there;
 * none of the three is the property itself. A duty, an activity and a defect
 * hang on their place this way. The property is named on every row anyway,
 * for its area and for the keys, so a fourth column that named it again for
 * the fourth target would say the same thing twice.
 */
export interface PlaceTarget {
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly buildingId: BuildingId | null
  readonly roomId: RoomId | null
  readonly assetId: AssetId | null
}
