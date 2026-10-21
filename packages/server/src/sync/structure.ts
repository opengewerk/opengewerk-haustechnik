import { boardAssetKind, type Identity, inverterAssetKind } from '@opengewerk/haustechnik-domain'
import {
  type FoundIdentity,
  sectionRefusal,
  structureProblem,
  type SyncCheck,
} from '@opengewerk/platform-server'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { boardSections, distributionBoards, inverters, rooms } from '../database/schema/index.js'

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

/**
 * A board stands in a building of its installation (#495): the one of the
 * asset or one it supplies, by itself or through a room in it, and a room it
 * names is one of that building. A device that names another gets a conflict
 * about the building or the room, `record_missing`, and the rest of its
 * transmission lands. Behind it the trigger of migration 0100 and the key
 * over room and building hold the same, for the whole transmission. A board
 * made without a building stands where its asset stands.
 */
export const boardInABuildingOfItsInstallation: Check = async ({
  tx,
  operation,
  values,
  current,
}) => {
  if (
    operation.entity !== 'distribution_boards' ||
    (operation.kind !== 'create' && operation.kind !== 'update') ||
    !('buildingId' in values || 'roomId' in values)
  ) {
    return null
  }

  const assetId = values['assetId'] ?? current?.['assetId']
  const buildingId = 'buildingId' in values ? values['buildingId'] : current?.['buildingId']
  const roomId = 'roomId' in values ? values['roomId'] : current?.['roomId']

  if (typeof buildingId !== 'string' || typeof assetId !== 'string') {
    return roomId ? { kind: 'conflict', reason: 'record_missing', fields: ['roomId'] } : null
  }

  const allowed = await tx.execute(
    sql`select 1 from assets a cross join lateral board_buildings_of(a.tenant_id, a.id) as b(id)
         where a.id = ${assetId} and b.id = ${buildingId}`,
  )

  if (allowed.rows.length === 0) {
    return { kind: 'conflict', reason: 'record_missing', fields: ['buildingId'] }
  }

  if (typeof roomId === 'string') {
    const [room] = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(
        and(
          eq(rooms.id, roomId as never),
          eq(rooms.buildingId, buildingId as never),
          isNull(rooms.deletedAt),
        ),
      )
      .limit(1)

    if (!room) {
      return { kind: 'conflict', reason: 'record_missing', fields: ['roomId'] }
    }
  }

  return null
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
