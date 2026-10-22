import { BadRequestException, NotFoundException, type StreamableFile } from '@nestjs/common'
import {
  type ActivityId,
  addDays,
  type IsoDate,
  type RoundPlanId,
  type RoundRecordState,
  roundTableColumns,
  roundTableRows,
} from '@opengewerk/haustechnik-domain'
import { type Database, isUuid, tableAnswer, tableFormatOf } from '@opengewerk/platform-server'
import { and, eq, gt, isNull, or } from 'drizzle-orm'

import { activities, roundPlans, roundRecords } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { inSight } from './activities.controller.js'
import type { Asking } from './places.js'
import { said } from './register-question.js'

/**
 * The record of a round as it stands (#518): the one of its last handing in.
 * A round opened again (#510) keeps the record before it as its history and
 * has none until it is handed in again; the database takes one record per
 * opening (`round_record_once_per_opening`).
 */
export const recordOfTheLastHandingIn = or(
  isNull(activities.reopenedAt),
  gt(roundRecords.createdAt, activities.reopenedAt),
)

const missingRound = 'Diesen Rundgang gibt es nicht oder nicht mehr.'
const missingPlan = 'Diesen Plan gibt es nicht oder nicht mehr.'

/** The longest period the rounds of a plan are given out for at once: a year and a day. */
const longestPeriod = 366

/**
 * The day a round was signed on in Germany: the last signature its frozen
 * state names, and the day it was performed where it names none. The day and
 * never the time (decided 15.10.2026).
 */
function signedOn(state: RoundRecordState): IsoDate {
  const last = state.signatures.at(-1)

  return last === undefined ? state.performedOn : dayInGermany(new Date(last.signedAt))
}

/** A day the address names, or the refusal that it names none. */
function dayOf(query: Readonly<Record<string, unknown>>, name: string, subject: string): IsoDate {
  const value = said(query, name)

  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${subject} ist ein Tag, geschrieben 2026-10-03.`)
  }

  return value as IsoDate
}

/**
 * A round as a table (#344, section 4.5 of the concept): a row per point of
 * its form, read from the state frozen with its signature and never from the
 * current records, without names and times of day. Whoever reads activities
 * and sees the round, as at its PDF.
 */
export function roundTable(
  database: Database,
  identity: Asking,
  id: string,
  query: Readonly<Record<string, unknown>>,
): Promise<StreamableFile> {
  const format = tableFormatOf(query)

  if (!isUuid(id)) {
    throw new NotFoundException(missingRound)
  }

  return database.forTenant(identity, async (tx) => {
    const [found] = await tx
      .select({ state: roundRecords.state })
      .from(activities)
      .innerJoin(
        roundRecords,
        and(eq(roundRecords.activityId, activities.id), recordOfTheLastHandingIn),
      )
      .where(
        and(
          eq(activities.id, id as ActivityId),
          eq(activities.kind, 'round'),
          isNull(activities.deletedAt),
          inSight(identity),
        ),
      )

    if (found === undefined) {
      throw new NotFoundException(
        'Eine Tabelle gibt es, sobald der Rundgang abgeschlossen ist: aus dem Stand, der mit der Unterschrift eingefroren wurde.',
      )
    }

    return tableAnswer(
      {
        name: `Rundgang ${found.state.title}`,
        columns: [...roundTableColumns],
        rows: roundTableRows(found.state, signedOn(found.state)),
      },
      format,
      dayInGermany(),
    )
  })
}

/**
 * The rounds of a plan over a period as one table (#344, decided 15.10.2026):
 * every round of the plan that was signed and frozen with a day of its
 * signature in the period, one after the other by that day, as the person
 * sees them. The temperatures of a month, for instance.
 */
export function planTable(
  database: Database,
  identity: Asking,
  id: string,
  query: Readonly<Record<string, unknown>>,
): Promise<StreamableFile> {
  const format = tableFormatOf(query)
  const from = dayOf(query, 'from', 'Der erste Tag')
  const to = dayOf(query, 'to', 'Der letzte Tag')

  if (to < from) {
    throw new BadRequestException('Der letzte Tag liegt nicht vor dem ersten.')
  }

  if (addDays(from, longestPeriod) <= to) {
    throw new BadRequestException(`Ein Zeitraum ist höchstens ${String(longestPeriod)} Tage lang.`)
  }

  if (!isUuid(id)) {
    throw new NotFoundException(missingPlan)
  }

  return database.forTenant(identity, async (tx) => {
    const [plan] = await tx
      .select({ id: roundPlans.id })
      .from(roundPlans)
      .where(and(eq(roundPlans.id, id as RoundPlanId), isNull(roundPlans.deletedAt)))

    if (plan === undefined) {
      throw new NotFoundException(missingPlan)
    }

    const found = await tx
      .select({ state: roundRecords.state })
      .from(activities)
      .innerJoin(
        roundRecords,
        and(eq(roundRecords.activityId, activities.id), recordOfTheLastHandingIn),
      )
      .where(
        and(
          eq(activities.roundPlanId, plan.id),
          eq(activities.kind, 'round'),
          isNull(activities.deletedAt),
          inSight(identity),
        ),
      )
    const rounds = found
      .map((row) => ({ state: row.state, on: signedOn(row.state) }))
      .filter((round) => round.on >= from && round.on <= to)
      .sort((left, right) => left.on.localeCompare(right.on))

    return tableAnswer(
      {
        name: `Rundgänge ${from} bis ${to}`,
        columns: [...roundTableColumns],
        rows: rounds.flatMap((round) => roundTableRows(round.state, round.on)),
      },
      format,
      dayInGermany(),
    )
  })
}
