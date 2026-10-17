import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common'
import {
  auditorReadAttached,
  type AuditorReadList,
  auditorReadNames,
  auditorReadPage,
  auditorReadWhat,
  type Catalogue,
  type DutyId,
  type EvidenceId,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import { accountsOf, CurrentIdentity, Database, isUuid } from '@opengewerk/platform-server'
import { desc, eq, inArray, lt } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'

import { assets, auditorReads, duties, evidence, properties } from '../database/schema/index.js'
import { dutyTitle } from '../database/duty-standing.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/**
 * Every read of an auditor from outside (#339, section 4.3 of the concept:
 * "jeder Zugriff festgehalten, und die Leitung sieht ihn"), newest first, a
 * page at a time, for whoever administers who works here. A duty or an
 * evidence the request named is said by its title and the number of its
 * asset, read as whoever asks sees it.
 */
@Controller('auditor-reads')
export class AuditorReadsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Get()
  @RequiresPermission('membership.read')
  async list(
    @CurrentIdentity() identity: Asking,
    @Query('before') before?: string,
  ): Promise<AuditorReadList> {
    const until = before === undefined ? null : new Date(before)

    if (until !== null && Number.isNaN(until.getTime())) {
      throw new BadRequestException('before ist ein Zeitpunkt.')
    }

    const read = await this.database.forTenant(identity, async (tx) => {
      const rows = await tx
        .select()
        .from(auditorReads)
        .where(until === null ? undefined : lt(auditorReads.readAt, until))
        .orderBy(desc(auditorReads.readAt), desc(auditorReads.id))
        .limit(auditorReadPage + 1)
      const named = (kind: 'duty' | 'evidence') => [
        ...new Set(
          rows.flatMap((row) => {
            const id = row.path.split('/')[2] ?? ''

            return auditorReadNames(row.route) === kind && isUuid(id) ? [id] : []
          }),
        ),
      ]
      // A register names the property it was asked for (#339).
      const askedFor = [
        ...new Set(
          rows.flatMap((row) => {
            const id = new URLSearchParams(row.query ?? '').get('propertyId') ?? ''

            return isUuid(id) ? [id] : []
          }),
        ),
      ]
      const propertyRows =
        askedFor.length === 0
          ? []
          : await tx
              .select({ id: properties.id, name: properties.name })
              .from(properties)
              .where(inArray(properties.id, askedFor as PropertyId[]))
      const evidenceRows =
        named('evidence').length === 0
          ? []
          : await tx
              .select({ id: evidence.id, dutyId: evidence.dutyId, number: evidence.number })
              .from(evidence)
              .where(inArray(evidence.id, named('evidence') as EvidenceId[]))
      const dutyIds = [...new Set([...named('duty'), ...evidenceRows.map((row) => row.dutyId)])]
      const dutyRows =
        dutyIds.length === 0
          ? []
          : await tx
              .select({
                id: duties.id,
                kind: duties.kind,
                kindVersion: duties.kindVersion,
                label: duties.label,
                assetNumber: assets.number,
              })
              .from(duties)
              .leftJoin(assets, eq(assets.id, duties.assetId))
              .where(inArray(duties.id, dutyIds as DutyId[]))

      return { rows, propertyRows, evidenceRows, dutyRows }
    })
    const names = await accountsOf(
      this.database,
      [...new Set(read.rows.map((row) => row.userId))],
      identity.userId,
    )
    const dutyWords = new Map(
      read.dutyRows.map((row) => [
        String(row.id),
        [dutyTitle(row, this.catalogue), row.assetNumber].filter(Boolean).join(', '),
      ]),
    )
    const evidenceRead = new Map(read.evidenceRows.map((row) => [String(row.id), row]))
    const propertyNames = new Map(read.propertyRows.map((row) => [String(row.id), row.name]))
    const subjectOf = (row: (typeof read.rows)[number]): string | null => {
      const id = row.path.split('/')[2] ?? ''

      switch (auditorReadNames(row.route)) {
        case 'duty':
          return dutyWords.get(id) ?? null
        case 'evidence': {
          const held = evidenceRead.get(id)

          return held === undefined
            ? null
            : [held.number, dutyWords.get(String(held.dutyId))].filter(Boolean).join(', ')
        }
        default: {
          const asked = new URLSearchParams(row.query ?? '')
          const parts = [
            propertyNames.get(asked.get('propertyId') ?? ''),
            asked.get('attach') === '1' ? auditorReadAttached : undefined,
          ].filter((part) => part !== undefined)

          return parts.length === 0 ? null : parts.join(', ')
        }
      }
    }
    const shown = read.rows.slice(0, auditorReadPage)

    return {
      reads: shown.map((row) => ({
        id: String(row.id),
        readAt: row.readAt.toISOString(),
        userId: row.userId,
        personName: names.get(row.userId)?.name ?? 'Unbekanntes Konto',
        what: auditorReadWhat(row.route),
        subject: subjectOf(row),
      })),
      more: read.rows.length > auditorReadPage,
    }
  }
}
