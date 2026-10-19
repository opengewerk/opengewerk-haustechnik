import { boardAssetKind, type Identity, inverterAssetKind } from '@opengewerk/haustechnik-domain'
import {
  type FoundIdentity,
  sectionRefusal,
  structureProblem,
  type SyncCheck,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { boardSections, distributionBoards, inverters } from '../database/schema/index.js'

// What the sync asks about the electrical structure below a low-voltage
// installation (#349) and the PV structure below a PV installation (#461)
// beside their place (`places.ts`): the questions of the foundation (ADR 0014
// in the repository opengewerk), the figures of every part and the section of
// a circuit, and the one this application adds, that an installation with
// boards or inverters stays what it is. The database holds each of them behind
// it, for the whole transmission: the checks and the enums of the tables, the
// key over section and board, and the triggers `boards_keep_their_installation`
// and `inverters_keep_their_installation`.

type Check = SyncCheck<FoundIdentity<Identity>>

/**
 * A figure of a circuit, an inverter, a string or a module out of bounds, a
 * curve that does not go with its device, or a kind of board nobody knows: a
 * mistake in the client, refused with the sentence its form shows, as the
 * trades application refuses it.
 */
export const structureFigures: Check = ({ operation, values, current }) => {
  const problem = structureProblem(operation.entity, values, current)

  return problem === null ? null : { kind: 'client', message: problem }
}

/**
 * The section a circuit names is one of its own board, and not marked: a
 * conflict about this one circuit, `record_missing` on the section, as for
 * any parent that is gone.
 */
export const sectionOfItsBoard: Check = async ({ tx, operation, values, current }) => {
  const refused = await sectionRefusal(boardSections, tx, operation, values, current)

  return refused ? { kind: 'conflict', reason: refused.reason, fields: refused.fields } : null
}

/** The top of each structure, by the kind of the asset it hangs on. */
const tops = [
  { kind: boardAssetKind, table: distributionBoards },
  { kind: inverterAssetKind, table: inverters },
] as const

/**
 * A low-voltage installation with boards that are not marked keeps its kind,
 * and so does a PV installation with inverters: the parts hang on it because
 * it is one. A device that changes the kind while somebody else put a board
 * or an inverter on it meanwhile gets a conflict about the kind,
 * `record_is_fixed`, and the rest of its transmission lands.
 */
export const installationKept: Check = async ({ tx, operation, values, current }) => {
  if (operation.entity !== 'assets' || operation.kind !== 'update' || !('kind' in values)) {
    return null
  }

  const top = tops.find((each) => current?.['kind'] === each.kind && values['kind'] !== each.kind)

  if (top === undefined) {
    return null
  }

  const [part] = await tx
    .select({ id: top.table.id })
    .from(top.table)
    .where(and(eq(top.table.assetId, operation.recordId as never), isNull(top.table.deletedAt)))
    .limit(1)

  return part ? { kind: 'conflict', reason: 'record_is_fixed', fields: ['kind'] } : null
}
