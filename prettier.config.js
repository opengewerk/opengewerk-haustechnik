// @ts-check
import shared from './upstream/opengewerk/.prettierrc.json' with { type: 'json' }

// The formatting of the foundation, read from the submodule and not written
// down a second time. Code that moves between the two repositories then moves
// without a reformatted diff.
export default shared
