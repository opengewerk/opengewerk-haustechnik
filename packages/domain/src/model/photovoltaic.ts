import type { Inverter, PvModule, PvString } from '@opengewerk/platform-domain'

import type { StructurePlace } from './electrical.js'

/**
 * The PV structure below a PV installation (#461, section 4.2 of the
 * concept): its inverters, the strings on each and the modules of a string.
 * What a part is and which figures it carries is the foundation's (ADR 0014
 * in the repository opengewerk), the same as in the trades application; what
 * this application adds is the place of a record, as for the electrical
 * structure beside it: the asset the structure hangs on with its property and
 * its area, carried by every part. An inverter names where it hangs as well,
 * so that somebody finds it in the building.
 */

/**
 * The one kind of asset an inverter hangs on, from the package Elektro
 * (1.4.0). A trigger of the database holds the same, and the sync asks
 * before it.
 */
export const inverterAssetKind = 'elektro.photovoltaic_installation'

/** An inverter on its PV installation, and where it hangs. */
export interface AssetInverter extends Inverter, StructurePlace {
  /** Where it hangs, in the words of whoever looks for it: "E.02 Lager, an der Nordwand". */
  readonly location: string | null
}

/** A string of an inverter, on the asset of its inverter. */
export interface AssetPvString extends PvString, StructurePlace {}

/** A module of a string, on the asset of its string. */
export interface AssetPvModule extends PvModule, StructurePlace {}
