import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
} from '@nestjs/common'
import {
  type ActivityId,
  activityKindLabel,
  type DefectId,
  type IsoDate,
  recordRetentionKinds,
  recordRetentionProblems,
  type RecordRetentionProposals,
  recordRetentionSentences,
  type RecordRetentionSettings,
  retentionProposalPage,
  retentionSentences,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  activities,
  activityEmptyings,
  assets,
  defectEmptyings,
  defects,
  properties,
  recordRetentionSettings,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf } from './places.js'

/** The years the operator set per kind, null for the law. */
export async function recordRetentionOf(tx: TenantTransaction): Promise<RecordRetentionSettings> {
  const [row] = await tx.select().from(recordRetentionSettings)

  return {
    activity: row?.activityYears ?? null,
    defect: row?.defectYears ?? null,
    task: row?.taskYears ?? null,
    reading_person: row?.readingPersonYears ?? null,
    booking_person: row?.bookingPersonYears ?? null,
  }
}

/** Whether the person of the transaction leads the operator, as the database says it (#340). */
async function leads(tx: TenantTransaction): Promise<boolean> {
  const { rows } = await tx.execute<{ leads: boolean }>(sql`select public.session_leads() as leads`)

  return rows[0]?.leads === true
}

/** The ids a confirmation names: at least one, at most a page, each a UUID, each once. */
function chosen(said: unknown, notEnded: string): readonly string[] {
  if (!Array.isArray(said) || said.length === 0) {
    throw new BadRequestException(recordRetentionSentences.nothingChosen)
  }

  if (said.length > retentionProposalPage) {
    throw new BadRequestException(retentionSentences.tooMany)
  }

  if (!said.every((id) => isUuid(id))) {
    throw new BadRequestException(notEnded)
  }

  return [...new Set(said as string[])]
}

/**
 * The retention of what hangs on no evidence under "Einstellungen" (#412,
 * section 2.6 of the concept, decided on 21.10.2026): the years of the
 * operator per kind, the activities without evidence and the remedied
 * defects whose retention has ended, and the confirmation that empties them.
 * A task done and the person at a reading and a booking go without one, on
 * the pass of the deadlines (`retention/removal.ts`).
 *
 * As with the evidence (#340), confirming is no right: it is whoever leads
 * the operator, and the database checks that and the end itself.
 */
@Controller('settings/record-retention')
export class RecordRetentionController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  read(@CurrentIdentity() identity: Asking): Promise<RecordRetentionSettings> {
    return this.database.forTenant(identity, recordRetentionOf)
  }

  /** Per kind a number of years from the law to 50, or null for the law. */
  @Put()
  @RequiresPermission('settings.write')
  set(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<RecordRetentionSettings> {
    const said = fieldsOf(body, recordRetentionKinds, recordRetentionKinds)
    const problems = recordRetentionProblems(said)

    if (Object.keys(problems).length > 0) {
      throw new BadRequestException(Object.values(problems).join(' '))
    }

    const years = (kind: (typeof recordRetentionKinds)[number]) =>
      (said[kind] ?? null) as number | null
    const values = {
      activityYears: years('activity'),
      defectYears: years('defect'),
      taskYears: years('task'),
      readingPersonYears: years('reading_person'),
      bookingPersonYears: years('booking_person'),
    }

    return this.database.forTenant(identity, async (tx) => {
      await tx
        .insert(recordRetentionSettings)
        .values({ tenantId: identity.tenantId, ...values })
        .onConflictDoUpdate({
          target: [recordRetentionSettings.tenantId],
          set: { ...values, updatedAt: new Date() },
        })

      return recordRetentionOf(tx)
    })
  }

  /**
   * The activities without evidence and the remedied defects whose retention
   * has ended, the one ended longest ago first, as far as the person sees
   * them. Nobody who did anything is named; that is what goes.
   */
  @Get('proposals')
  @RequiresPermission('settings.read')
  proposals(@CurrentIdentity() identity: Asking): Promise<RecordRetentionProposals> {
    const today = dayInGermany()
    const activityEnds = sql<string | null>`public.activity_retention_ends(${activities.id})`
    const defectEnds = sql<string | null>`public.defect_retention_ends(${defects.id})`

    return this.database.forTenant(identity, async (tx) => {
      const activityRows = await tx
        .select({
          id: activities.id,
          kind: activities.kind,
          title: activities.title,
          endedOn: sql<string>`public.activity_ended_day(${activities.id})`,
          propertyName: properties.name,
          endsOn: activityEnds,
        })
        .from(activities)
        .innerJoin(properties, eq(properties.id, activities.propertyId))
        .where(
          and(
            isNull(activities.emptiedAt),
            isNull(activities.collectiveId),
            inArray(activities.status, ['done', 'not_performed']),
            sql`${activityEnds} <= ${today}::date`,
          ),
        )
        .orderBy(asc(activityEnds), asc(activities.id))
        .limit(retentionProposalPage + 1)
      const defectRows = await tx
        .select({
          id: defects.id,
          foundOn: defects.foundOn,
          remediedOn: sql<string>`public.defect_remedied_day(${defects.id})`,
          description: defects.description,
          propertyName: properties.name,
          assetName: assets.name,
          endsOn: defectEnds,
        })
        .from(defects)
        .innerJoin(properties, eq(properties.id, defects.propertyId))
        .leftJoin(assets, eq(assets.id, defects.assetId))
        .where(
          and(
            isNull(defects.emptiedAt),
            inArray(defects.status, ['remedied', 'verified']),
            sql`${defectEnds} <= ${today}::date`,
          ),
        )
        .orderBy(asc(defectEnds), asc(defects.id))
        .limit(retentionProposalPage + 1)

      return {
        activities: activityRows.slice(0, retentionProposalPage).map((row) => ({
          activityId: row.id,
          kind: activityKindLabel[row.kind],
          title: row.title,
          endedOn: row.endedOn as IsoDate,
          place: row.propertyName,
          retentionEndedOn: row.endsOn as IsoDate,
        })),
        defects: defectRows.slice(0, retentionProposalPage).map((row) => ({
          defectId: row.id,
          foundOn: row.foundOn as IsoDate,
          remediedOn: row.remediedOn as IsoDate,
          description: row.description,
          place:
            row.assetName === null ? row.propertyName : `${row.propertyName}, ${row.assetName}`,
          retentionEndedOn: row.endsOn as IsoDate,
        })),
        mayConfirm: await leads(tx),
        more:
          activityRows.length > retentionProposalPage || defectRows.length > retentionProposalPage,
      }
    })
  }

  /**
   * The confirmation of whoever leads the operator for activities, up to a
   * page at once, all or none: a row each in `activity_emptyings`, which the
   * database checks and turns into the shell of #409.
   */
  @Post('activity-emptyings')
  @RequiresPermission('settings.read')
  confirmActivities(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ readonly emptied: number }> {
    const { activityIds } = fieldsOf(body, ['activityIds'], [])
    const ids = chosen(activityIds, recordRetentionSentences.activityNotEnded) as ActivityId[]

    return this.database.forTenant(identity, async (tx) => {
      if (!(await leads(tx))) {
        throw new ForbiddenException(retentionSentences.notLeading)
      }

      const found = await tx
        .select({ id: activities.id, propertyId: activities.propertyId, areaId: activities.areaId })
        .from(activities)
        .where(inArray(activities.id, ids))

      // One the person does not see is one that has not ended for them.
      if (found.length !== ids.length) {
        throw new BadRequestException(recordRetentionSentences.activityNotEnded)
      }

      // The five columns the application may write; the database writes the rest.
      await tx.execute(
        sql`insert into ${activityEmptyings} (tenant_id, property_id, area_id, activity_id, confirmed_by)
            values ${sql.join(
              found.map(
                (row) =>
                  sql`(${identity.tenantId}, ${row.propertyId}, ${row.areaId}, ${row.id}, ${identity.userId})`,
              ),
              sql`, `,
            )}`,
      )

      return { emptied: found.length }
    })
  }

  /** The same for remedied defects, a row each in `defect_emptyings`. */
  @Post('defect-emptyings')
  @RequiresPermission('settings.read')
  confirmDefects(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ readonly emptied: number }> {
    const { defectIds } = fieldsOf(body, ['defectIds'], [])
    const ids = chosen(defectIds, recordRetentionSentences.defectNotEnded) as DefectId[]

    return this.database.forTenant(identity, async (tx) => {
      if (!(await leads(tx))) {
        throw new ForbiddenException(retentionSentences.notLeading)
      }

      const found = await tx
        .select({ id: defects.id, propertyId: defects.propertyId, areaId: defects.areaId })
        .from(defects)
        .where(inArray(defects.id, ids))

      if (found.length !== ids.length) {
        throw new BadRequestException(recordRetentionSentences.defectNotEnded)
      }

      await tx.execute(
        sql`insert into ${defectEmptyings} (tenant_id, property_id, area_id, defect_id, confirmed_by)
            values ${sql.join(
              found.map(
                (row) =>
                  sql`(${identity.tenantId}, ${row.propertyId}, ${row.areaId}, ${row.id}, ${identity.userId})`,
              ),
              sql`, `,
            )}`,
      )

      return { emptied: found.length }
    })
  }
}
