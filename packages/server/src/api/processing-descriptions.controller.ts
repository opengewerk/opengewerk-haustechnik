import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  changedSections,
  describeProcessing,
  type ProcessingDescriptions,
  processingFactLines,
  processingHoldsFor,
  type ProcessingVersion,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { desc, eq } from 'drizzle-orm'

import { processingDescriptions } from '../database/schema/index.js'
import { keeperOf } from '../labels/faces.js'
import { processingFactsOf } from '../processing-description/facts.js'
import { processingPrintJob } from '../processing-description/page.js'
import { processingTemplate } from '../processing-description/template.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'
import { pdf, Printer } from './prints.controller.js'

/** What a route needs of the answer: one header. */
interface Response {
  setHeader(name: string, value: string): void
}

/** Why there is no PDF: the description is not one of this operator. */
const noSuchDescription = 'Diese Verfahrensbeschreibung gibt es bei diesem Betreiber nicht.'

const inGermany = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** A moment as the description names it, "19.10.2026 um 09:12", whatever the clock of the server says. */
export function madeAtInWords(moment: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    inGermany.formatToParts(moment).find((each) => each.type === type)?.value ?? ''

  return `${part('day')}.${part('month')}.${part('year')} um ${part('hour')}:${part('minute')}`
}

/** The newest description of the operator, or none. */
async function newestOf(tx: TenantTransaction) {
  const [row] = await tx
    .select({ text: processingDescriptions.text })
    .from(processingDescriptions)
    .orderBy(desc(processingDescriptions.createdAt), desc(processingDescriptions.id))
    .limit(1)

  return row ?? null
}

/**
 * The description of the processing (#357, section 9 of the concept): made by
 * the Leitung from what is switched on and set at the operator, kept with its
 * day, and printed as it was made. "Auskunft, Verfahrensbeschreibung und
 * Verzeichnis erzeugen" for every route, which only the Leitung holds
 * (decided on 15.10.2026): the list names who made each one.
 *
 * Held by `processing-descriptions.test.ts` against the database: the three
 * other shipped roles are refused at every route, the application role can
 * neither change nor remove a description (42501 from the grants of 0086),
 * another operator sees none of them, not by the address of its PDF either,
 * and a role of the operator's own is never given the right. The isolation of
 * the table by operator is a row of `tenant-isolation.test.ts`.
 */
@Controller('settings/processing-descriptions')
export class ProcessingDescriptionsController {
  constructor(
    private readonly database: Database,
    private readonly printer: Printer,
  ) {}

  /** The settings as the description names them, what a description made now would change, and every one made, newest first. */
  @Get()
  @RequiresPermission('privacy.generate')
  async list(@CurrentIdentity() identity: Asking): Promise<ProcessingDescriptions> {
    const read = await this.database.forTenant(identity, async (tx) => {
      const facts = await processingFactsOf(tx)
      const newest = await newestOf(tx)
      const now =
        newest === null
          ? null
          : describeProcessing(processingTemplate(), {
              operator: await keeperOf(tx),
              at: madeAtInWords(new Date()),
              facts,
            })
      const rows = await tx
        .select({
          id: processingDescriptions.id,
          madeAt: processingDescriptions.createdAt,
          madeBy: processingDescriptions.madeBy,
          holdsFor: processingDescriptions.holdsFor,
          changed: processingDescriptions.changed,
        })
        .from(processingDescriptions)
        .orderBy(desc(processingDescriptions.createdAt), desc(processingDescriptions.id))

      return {
        facts: processingFactLines(facts, true),
        changedSinceNewest:
          newest === null || now === null ? null : changedSections(newest.text, now),
        rows,
      }
    })
    const names = await accountsOf(
      this.database,
      [...new Set(read.rows.map((row) => row.madeBy))],
      identity.userId,
    )

    return {
      facts: read.facts,
      changedSinceNewest: read.changedSinceNewest,
      versions: read.rows.map((row): ProcessingVersion => ({
        id: row.id,
        madeAt: row.madeAt.toISOString(),
        madeBy: names.get(row.madeBy)?.name ?? null,
        holdsFor: row.holdsFor,
        changed: row.changed,
      })),
    }
  }

  /** A description made now and kept, with the sections that differ from the newest before it. */
  @Post()
  @RequiresPermission('privacy.generate')
  make(@CurrentIdentity() identity: Asking): Promise<ProcessingVersion> {
    return this.database.forTenant(identity, async (tx) => {
      const madeAt = new Date()
      const text = describeProcessing(processingTemplate(), {
        operator: await keeperOf(tx),
        at: madeAtInWords(madeAt),
        facts: await processingFactsOf(tx),
      })
      const newest = await newestOf(tx)
      const changed = newest === null ? null : [...changedSections(newest.text, text)]
      const [row] = await tx
        .insert(processingDescriptions)
        .values({
          tenantId: identity.tenantId,
          madeBy: identity.userId,
          holdsFor: processingHoldsFor(text),
          text,
          changed,
          createdAt: madeAt,
          updatedAt: madeAt,
        })
        .returning({ id: processingDescriptions.id, madeAt: processingDescriptions.createdAt })

      return {
        id: row?.id ?? '',
        madeAt: (row?.madeAt ?? madeAt).toISOString(),
        madeBy: null,
        holdsFor: processingHoldsFor(text),
        changed,
      }
    })
  }

  /** A description as it was made, as a PDF. */
  @Get(':id/pdf')
  @RequiresPermission('privacy.generate')
  async print(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const [row] = /^[0-9a-f-]{36}$/.test(id)
        ? await tx
            .select({ text: processingDescriptions.text, madeAt: processingDescriptions.createdAt })
            .from(processingDescriptions)
            .where(
              eq(processingDescriptions.id, id as typeof processingDescriptions.$inferSelect.id),
            )
        : []

      return row === undefined ? null : { ...row, operator: await keeperOf(tx) }
    })

    if (found === null) {
      throw new NotFoundException(noSuchDescription)
    }

    const day = madeAtInWords(found.madeAt).slice(0, 10)
    const bytes = await this.printer.fresh(
      processingPrintJob(
        found.text,
        `Verfahrensbeschreibung für ${found.operator}, erzeugt am ${madeAtInWords(found.madeAt)}.`,
      ),
    )

    return pdf(response, bytes, `Verfahrensbeschreibung ${day}`)
  }
}
