import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Put,
} from '@nestjs/common'
import {
  type Catalogue,
  type EvidenceId,
  type IsoDate,
  retentionInWords,
  retentionProposalPage,
  type RetentionProposals,
  retentionSentences,
  type RetentionSettings,
  retentionSettingsProblem,
  type StatedRetention,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { dutyTitle } from '../database/duty-standing.js'
import {
  assets,
  duties,
  evidence,
  evidenceEmptyings,
  evidenceRetentionSettings,
  properties,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf } from './places.js'

/** The longer retention of the operator, or none. */
export async function minimumYearsOf(tx: TenantTransaction): Promise<number | null> {
  const [row] = await tx
    .select({ minimumYears: evidenceRetentionSettings.minimumYears })
    .from(evidenceRetentionSettings)

  return row?.minimumYears ?? null
}

/** Whether the person of the transaction leads the operator, as the database says it (#340). */
async function leads(tx: TenantTransaction): Promise<boolean> {
  const { rows } = await tx.execute<{ leads: boolean }>(sql`select public.session_leads() as leads`)

  return rows[0]?.leads === true
}

/**
 * The retention of the evidence under "Einstellungen" (section 2.6 of the
 * concept, #340): the longer retention of the operator, the evidence whose
 * retention has ended, and the confirmation that deletes them.
 *
 * Seeing and setting it is what the settings take. Confirming a deletion is
 * no right at all, since no right deletes an evidence: it is whoever leads
 * the operator, and the database checks that and the end of the retention
 * itself before it empties anything (ADR 0004, addendum of 17.10.2026).
 */
@Controller('settings/evidence-retention')
export class EvidenceRetentionController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Get()
  @RequiresPermission('settings.read')
  read(@CurrentIdentity() identity: Asking): Promise<RetentionSettings> {
    return this.database.forTenant(identity, async (tx) => ({
      minimumYears: await minimumYearsOf(tx),
    }))
  }

  /** A number of years from 1 to 50, or null for the rule alone. */
  @Put()
  @RequiresPermission('settings.write')
  set(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<RetentionSettings> {
    const { minimumYears } = fieldsOf(body, ['minimumYears'], ['minimumYears'])
    const problem = retentionSettingsProblem(minimumYears ?? null)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    const years = (minimumYears ?? null) as number | null

    return this.database.forTenant(identity, async (tx) => {
      await tx
        .insert(evidenceRetentionSettings)
        .values({ tenantId: identity.tenantId, minimumYears: years })
        .onConflictDoUpdate({
          target: [evidenceRetentionSettings.tenantId],
          set: { minimumYears: years, updatedAt: new Date() },
        })

      return { minimumYears: years }
    })
  }

  /**
   * The evidence whose retention has ended, as the run proposes it: the one
   * ended longest ago first. Who did it is not said; that is what goes.
   */
  @Get('proposals')
  @RequiresPermission('settings.read')
  proposals(@CurrentIdentity() identity: Asking): Promise<RetentionProposals> {
    const today = dayInGermany()
    const ends = sql<string | null>`public.evidence_retention_ends(${evidence.id})`

    return this.database.forTenant(identity, async (tx) => {
      const minimumYears = await minimumYearsOf(tx)
      const rows = await tx
        .select({
          id: evidence.id,
          number: evidence.number,
          performedOn: evidence.performedOn,
          retention: sql<StatedRetention | null>`${evidence.state} -> 'retention'`,
          endsOn: ends,
          kind: duties.kind,
          kindVersion: duties.kindVersion,
          label: duties.label,
          assetNumber: assets.number,
          assetName: assets.name,
          propertyName: properties.name,
        })
        .from(evidence)
        .innerJoin(duties, eq(duties.id, evidence.dutyId))
        .leftJoin(assets, eq(assets.id, duties.assetId))
        .innerJoin(properties, eq(properties.id, evidence.propertyId))
        .where(and(isNull(evidence.emptiedAt), sql`${ends} <= ${today}::date`))
        .orderBy(asc(ends), asc(evidence.number))
        .limit(retentionProposalPage + 1)

      return {
        proposals: rows.slice(0, retentionProposalPage).map((row) => ({
          evidenceId: row.id,
          number: row.number,
          performedOn: row.performedOn as IsoDate,
          dutyTitle: dutyTitle(row, this.catalogue),
          asset: row.assetName === null ? null : { number: row.assetNumber, name: row.assetName },
          propertyName: row.propertyName,
          retention: retentionInWords(row.retention, minimumYears),
          endedOn: row.endsOn as IsoDate,
        })),
        mayConfirm: await leads(tx),
        more: rows.length > retentionProposalPage,
      }
    })
  }

  /**
   * The confirmation of whoever leads the operator, for up to a page at once,
   * all or none: a row each in `evidence_emptyings`, which the database
   * checks and turns into the empty shell (ADR 0004, addendum of 17.10.2026).
   */
  @Post('emptyings')
  @RequiresPermission('settings.read')
  confirm(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ readonly emptied: number }> {
    const { evidenceIds } = fieldsOf(body, ['evidenceIds'], [])

    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
      throw new BadRequestException(retentionSentences.nothingChosen)
    }

    if (evidenceIds.length > retentionProposalPage) {
      throw new BadRequestException(retentionSentences.tooMany)
    }

    if (!evidenceIds.every((id) => isUuid(id))) {
      throw new BadRequestException(retentionSentences.notEnded)
    }

    const ids = [...new Set(evidenceIds as EvidenceId[])]

    return this.database.forTenant(identity, async (tx) => {
      if (!(await leads(tx))) {
        throw new ForbiddenException(retentionSentences.notLeading)
      }

      const found = await tx
        .select({ id: evidence.id, propertyId: evidence.propertyId, areaId: evidence.areaId })
        .from(evidence)
        .where(inArray(evidence.id, ids))

      // One the person does not see is one that has not ended for them.
      if (found.length !== ids.length) {
        throw new BadRequestException(retentionSentences.notEnded)
      }

      // The five columns the application may write; the database writes the rest.
      await tx.execute(
        sql`insert into ${evidenceEmptyings} (tenant_id, property_id, area_id, evidence_id, confirmed_by)
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
