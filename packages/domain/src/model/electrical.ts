import {
  type BoardSection,
  type Circuit,
  type CircuitFacts,
  type DistributionBoard,
  type DistributionBoardKind,
  type Equipment,
  inStructureOrder,
  milliText,
  tripCharacteristicLabel,
} from '@opengewerk/platform-domain'

import type { AnswerCircuit } from './answer.js'
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

/**
 * Where a part of the structure lies: its asset, with the property and the
 * area of that. The PV structure lies the same way (#461).
 */
export interface StructurePlace {
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

/**
 * A board as the order of the chart needs it (#350): plain values, as a
 * device holds them and the server reads them, so that both work out the
 * same order.
 */
export interface ChartBoard {
  readonly id: string
  readonly kind: DistributionBoardKind
  readonly designation: string
  readonly position: number
}

/** A section of a board, as the order of the chart needs it. */
export interface ChartSection {
  readonly id: string
  readonly distributionBoardId: string
  readonly designation: string
  readonly position: number
}

/** A circuit, with what the order of the chart and its limits need of it. */
export interface ChartCircuit extends CircuitFacts {
  readonly id: string
  readonly distributionBoardId: string
  readonly boardSectionId: string | null
  readonly designation: string
  readonly consumer: string | null
  readonly position: number
}

/**
 * A circuit in the order of the chart (#350): as the answers of a form are
 * judged with it, and the kind of its board, which an evidence names beside
 * the designation of the board. The page that is signed holds what the
 * answers are judged with and not the kind.
 */
export interface ChartedCircuit extends AnswerCircuit {
  readonly boardKind: DistributionBoardKind
}

/**
 * The circuits of an installation in the order of its circuit chart (#350),
 * the same on the device and on the server: board by board as the boards
 * stand, on each board the circuits directly on it first and then section by
 * section, a circuit whose section is not among those given counting as on
 * the board directly, the way the chart prints it. Each in the order of the
 * structure (`inStructureOrder`), the way the foundation lists a block of
 * each circuit (`blockCircuits` in `platform-web`), with the designation of
 * its board and its place, counted from nought over every board.
 *
 * The boards are those of the installation, the sections and circuits may be
 * of any board: those of another one are left out. Whoever calls leaves out
 * what is marked as deleted.
 */
export function circuitsInChartOrder(
  boards: readonly ChartBoard[],
  sections: readonly ChartSection[],
  circuits: readonly ChartCircuit[],
): readonly ChartedCircuit[] {
  const ordered = [...boards].sort(inStructureOrder).flatMap((board) => {
    const own = sections
      .filter((section) => section.distributionBoardId === board.id)
      .sort(inStructureOrder)
    const ownIds = new Set(own.map((section) => section.id))
    const onBoard = circuits.filter((circuit) => circuit.distributionBoardId === board.id)
    const direct = onBoard
      .filter((circuit) => circuit.boardSectionId === null || !ownIds.has(circuit.boardSectionId))
      .sort(inStructureOrder)

    return [
      ...direct,
      ...own.flatMap((section) =>
        onBoard.filter((circuit) => circuit.boardSectionId === section.id).sort(inStructureOrder),
      ),
    ].map((circuit) => ({ circuit, board }))
  })

  return ordered.map(({ circuit, board }, place) => ({
    id: circuit.id,
    designation: circuit.designation,
    consumer: circuit.consumer,
    tripCharacteristic: circuit.tripCharacteristic,
    ratedCurrentMilli: circuit.ratedCurrentMilli,
    ratedResidualCurrentMilli: circuit.ratedResidualCurrentMilli,
    board: board.designation,
    boardKind: board.kind,
    place,
  }))
}

/**
 * What protects a circuit, in the words of a table of measurements (#350):
 * the characteristic with the rated current, and the rated residual current
 * of its RCD, `B 16 A, RCD 30 mA`. Null when neither is known; a
 * characteristic without a rated current says nothing a limit can be worked
 * out from, so it stands only with one.
 */
export function circuitProtectionWords(circuit: CircuitFacts): string | null {
  const parts = [
    circuit.ratedCurrentMilli === null
      ? null
      : [
          circuit.tripCharacteristic === null
            ? null
            : tripCharacteristicLabel[circuit.tripCharacteristic],
          `${milliText(circuit.ratedCurrentMilli)} A`,
        ]
          .filter((part) => part !== null)
          .join(' '),
    circuit.ratedResidualCurrentMilli === null
      ? null
      : `RCD ${String(circuit.ratedResidualCurrentMilli)} mA`,
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : parts.join(', ')
}
