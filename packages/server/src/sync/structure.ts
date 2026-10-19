import { boardAssetKind, type Identity } from '@opengewerk/haustechnik-domain'
import {
  type FoundIdentity,
  sectionRefusal,
  structureProblem,
  type SyncCheck,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { boardSections, distributionBoards } from '../database/schema/index.js'

// What the sync asks about the electrical structure below a low-voltage
// installation (#349) beside its place (`places.ts`): the questions of the
// foundation (ADR 0014 in the repository opengewerk), the figures and the
// section of a circuit, and the one this application adds, that a low-voltage
// installation with boards stays one. The database holds each of them behind
// it, for the whole transmission: the checks and the enums of the tables, the
// key over section and board, and the trigger `boards_keep_their_installation`.

type Check = SyncCheck<FoundIdentity<Identity>>

/**
 * A figure of a circuit out of bounds, a curve that does not go with its
 * device, or a kind of board nobody knows: a mistake in the client, refused
 * with the sentence its form shows, as the trades application refuses it.
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

/**
 * A low-voltage installation with boards that are not marked keeps its kind:
 * the boards hang on it because it is one. A device that changes the kind
 * while somebody else put a board on it meanwhile gets a conflict about the
 * kind, `record_is_fixed`, and the rest of its transmission lands.
 */
export const installationKept: Check = async ({ tx, operation, values, current }) => {
  if (
    operation.entity !== 'assets' ||
    operation.kind !== 'update' ||
    !('kind' in values) ||
    values['kind'] === boardAssetKind ||
    current?.['kind'] !== boardAssetKind
  ) {
    return null
  }

  const [board] = await tx
    .select({ id: distributionBoards.id })
    .from(distributionBoards)
    .where(
      and(
        eq(distributionBoards.assetId, operation.recordId as never),
        isNull(distributionBoards.deletedAt),
      ),
    )
    .limit(1)

  return board ? { kind: 'conflict', reason: 'record_is_fixed', fields: ['kind'] } : null
}
