import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { AreaId, Identity, Right } from '@opengewerk/haustechnik-domain'
import {
  isUuid,
  pick,
  type RequestIdentity,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import { areas } from '../database/schema/index.js'

// What the routes of the place share: how a body becomes the values of a row,
// how a refusal of the model is answered, and how a row is found that is
// there for the person asking. The routes of each level are in a controller
// of their own.

/** Who is asking, with the right the route declared as the reason. */
export type Asking = RequestIdentity<Identity, Right>

/**
 * The fields of a body a route accepts, with every text trimmed. An optional
 * text left empty is no text: it is stored as null, never as an empty string
 * the database would refuse.
 */
export function fieldsOf<Field extends string>(
  body: unknown,
  fields: readonly Field[],
  optional: readonly Field[] = [],
): Partial<Record<Field, unknown>> {
  const picked = pick(body, fields)

  for (const field of Object.keys(picked) as Field[]) {
    const value = picked[field]

    if (typeof value === 'string') {
      const trimmed = value.trim()

      picked[field] = trimmed === '' && optional.includes(field) ? null : trimmed
    }
  }

  return picked
}

/**
 * Refuses what the model in `domain` finds wrong, with its first sentence. The
 * database holds the same rules behind it for every other way in.
 */
export function refuse(problems: Readonly<Record<string, string>>): void {
  const [problem] = Object.values(problems)

  if (problem !== undefined) {
    throw new BadRequestException(problem)
  }
}

/** A table of the place, as the lookup below needs it. */
type PlaceTable = PgTable & { id: PgColumn; deletedAt: PgColumn }

/**
 * The row of a place that is there for the person asking: not marked
 * deleted, and in one of their areas, which the policy decides. A row that
 * is not, a row of another tenant and an id that is no id at all get the
 * same answer, so that the answer says nothing about what is elsewhere.
 */
export async function placeOf<Row>(
  tx: TenantTransaction,
  table: PlaceTable,
  id: string,
  missing: string,
): Promise<Row> {
  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  const [row] = await tx
    .select()
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))

  if (row === undefined) {
    throw new NotFoundException(missing)
  }

  return row as Row
}

/**
 * The area a new property goes into: the one the body names, or, while the
 * tenant has a single area, that one. A small tenant never names an area.
 */
export async function areaFor(tx: TenantTransaction, named: unknown): Promise<AreaId> {
  if (named !== undefined && named !== null) {
    if (typeof named !== 'string' || !isUuid(named)) {
      throw new BadRequestException('Den Bereich gibt es bei diesem Betreiber nicht.')
    }

    const [area] = await tx
      .select({ id: areas.id })
      .from(areas)
      .where(eq(areas.id, named as AreaId))

    if (area === undefined) {
      throw new BadRequestException('Den Bereich gibt es bei diesem Betreiber nicht.')
    }

    return area.id
  }

  const found = await tx.select({ id: areas.id }).from(areas).limit(2)

  if (found.length !== 1 || found[0] === undefined) {
    throw new BadRequestException(
      'Der Bereich fehlt. Dieser Betreiber hat mehrere, die Liegenschaft nennt einen davon.',
    )
  }

  return found[0].id
}
