import type {
  BoardSection,
  Circuit,
  DistributionBoard,
  Equipment,
} from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import type { PropertyId } from './location.js'

/**
 * The electrical structure below a low-voltage installation (#349, section
 * 4.2 of the concept): boards, their sections, the circuits and the equipment
 * on a circuit. What a part is and which figures it carries is the
 * foundation's (ADR 0014 in the repository opengewerk), the same as in the
 * trades application; what this application adds is the place of a record,
 * the asset the structure hangs on with its property and its area. A board
 * names the asset; every part below it carries the same one, so that it lies
 * in the area of its asset like every row with a place (ADR 0003).
 */

/**
 * The one kind of asset a board hangs on (decision 31 of phase 2: "Unter der
 * Niederspannungsanlage wie in OpenGewerk"). A trigger of the database holds
 * the same, and the sync asks before it.
 */
export const boardAssetKind = 'elektro.low_voltage_installation'

/** Where a part of the structure lies: its asset, with the property and the area of that. */
interface StructurePlace {
  readonly assetId: AssetId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
}

/** A board on its low-voltage installation. */
export interface AssetBoard extends DistributionBoard, StructurePlace {}

/** A section of a board, on the asset of its board. */
export interface AssetBoardSection extends BoardSection, StructurePlace {}

/** A circuit of a board, on the asset of its board. */
export interface AssetCircuit extends Circuit, StructurePlace {}

/** A piece of equipment on a circuit, on the asset of its circuit. */
export interface AssetEquipment extends Equipment, StructurePlace {}
