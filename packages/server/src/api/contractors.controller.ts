import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  byNameIn,
  type Catalogue,
  type Contractor,
  contractorBounds,
  type ContractorEntry,
  type ContractorId,
  type ContractorName,
  type ContractorPage,
  contractorProblems,
  contractorServices,
  contractorServicesWords,
  type IsoDate,
  sameFirmName,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, count, desc, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { dutyTitle } from '../database/duty-standing.js'
import { activities, contractors, duties, evidence } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, refuse } from './places.js'

const missing = 'Diese Fremdfirma gibt es nicht oder nicht mehr.'

/** The texts of a contractor besides its name, which may be emptied. */
const texts = ['street', 'postalCode', 'city', 'phone', 'email', 'note'] as const

/** The fields of a contractor as a body sends them, judged; the services kept once each and in order. */
function contractorValues(body: unknown, creating: boolean): Record<string, unknown> {
  const values = fieldsOf(body, ['name', 'services', ...texts], texts)

  if (creating) {
    values.name ??= ''
    values.services ??= []
  }

  refuse(contractorProblems(values))

  if (Array.isArray(values.services)) {
    values.services = contractorServices.filter((service) =>
      (values.services as readonly unknown[]).includes(service),
    )
  }

  return values
}

/** A live firm of the tenant, or the refusal that it is not there. */
async function heldContractor(
  tx: TenantTransaction,
  id: string,
): Promise<typeof contractors.$inferSelect> {
  const [row] = isUuid(id)
    ? await tx
        .select()
        .from(contractors)
        .where(and(eq(contractors.id, id as ContractorId), isNull(contractors.deletedAt)))
    : []

  if (row === undefined) {
    throw new NotFoundException(missing)
  }

  return row
}

/** A duty that still calls for something on a day: not removed and not ended. */
function openDuty(on: IsoDate): SQL | undefined {
  return and(isNull(duties.deletedAt), or(isNull(duties.endsOn), gt(duties.endsOn, on)))
}

/** An activity whose work is still to be done or signed. */
const openActivity = and(
  isNull(activities.deletedAt),
  inArray(activities.status, ['open', 'started', 'signed']),
)

/** How many open duties name each firm, counted where the person sees them. */
async function openDutiesOf(
  tx: TenantTransaction,
  on: IsoDate,
): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({ contractorId: duties.contractorId, open: count() })
    .from(duties)
    .where(and(openDuty(on), eq(duties.performer, 'contractor')))
    .groupBy(duties.contractorId)

  return new Map(
    rows.flatMap((row) => (row.contractorId === null ? [] : [[row.contractorId, row.open]])),
  )
}

/**
 * The contractors of an operator (#328, section 4.11 of the concept): every
 * role reads them, the Leitung and the Technische Leitung keep them. A firm
 * is marked when it is removed, and that is refused while an open duty or an
 * activity still to be done names it (decided 15.10.2026).
 */
@Controller('contractors')
export class ContractorsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** Every live firm by its name, with the open duties that name it. */
  @Get()
  @RequiresPermission('contractor.read')
  list(@CurrentIdentity() identity: Asking): Promise<ContractorEntry[]> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const open = await openDutiesOf(tx, today)

      return (await tx.select().from(contractors).where(isNull(contractors.deletedAt)))
        .sort((left, right) => byNameIn(left.name, right.name))
        .map((row) => ({ ...row, openDuties: open.get(row.id) ?? 0 }))
    })
  }

  /** The live firms as a table, `?format=xlsx` or `csv`, as the list shows them. */
  @Get('table')
  @RequiresPermission('contractor.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const open = await openDutiesOf(tx, today)
      const rows = (await tx.select().from(contractors).where(isNull(contractors.deletedAt))).sort(
        (left, right) => byNameIn(left.name, right.name),
      )

      return tableAnswer(
        {
          name: 'Fremdfirmen',
          columns: [
            'Name',
            'Straße',
            'PLZ',
            'Ort',
            'Telefon',
            'E-Mail',
            'Leistungen',
            'Offene Pflichten',
          ],
          rows: rows.map((row) => [
            row.name,
            row.street,
            row.postalCode,
            row.city,
            row.phone,
            row.email,
            contractorServicesWords(row.services),
            open.get(row.id) ?? 0,
          ]),
        },
        format,
        today,
      )
    })
  }

  /**
   * The names that stand as text at duties a contractor performs and that
   * name no firm of the list, with how many duties bear each, and the firm of
   * the list with the same name where there is one (decided 15.10.2026).
   */
  @Get('names')
  @RequiresPermission('contractor.write')
  names(@CurrentIdentity() identity: Asking): Promise<ContractorName[]> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const rows = await tx
        .select({ name: duties.performerNote, duties: count() })
        .from(duties)
        .where(
          and(openDuty(today), eq(duties.performer, 'contractor'), isNull(duties.contractorId)),
        )
        .groupBy(duties.performerNote)
      const live = await tx
        .select({ id: contractors.id, name: contractors.name })
        .from(contractors)
        .where(isNull(contractors.deletedAt))

      return rows
        .flatMap((row) =>
          row.name === null
            ? []
            : [
                {
                  name: row.name,
                  duties: row.duties,
                  contractorId:
                    live.find((firm) => sameFirmName(firm.name, row.name as string))?.id ?? null,
                },
              ],
        )
        .sort((left, right) => byNameIn(left.name, right.name))
    })
  }

  /**
   * Takes names over (decided 15.10.2026): each becomes a firm of the list,
   * or the one it names, and the open duties that bear the name as text name
   * the firm from then on. The note stays as it stood; evidence keeps its
   * organisation as it was written.
   */
  @Post('takeover')
  @RequiresPermission('contractor.write')
  takeover(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<{ readonly firms: number; readonly duties: number }> {
    const items = (body as { items?: unknown } | null)?.items

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > contractorBounds.takeover ||
      items.some(
        (item) =>
          typeof item !== 'object' ||
          item === null ||
          typeof (item as { name?: unknown }).name !== 'string' ||
          ((item as { contractorId?: unknown }).contractorId !== undefined &&
            (item as { contractorId?: unknown }).contractorId !== null &&
            typeof (item as { contractorId?: unknown }).contractorId !== 'string'),
      )
    ) {
      throw new BadRequestException(
        `Eine Übernahme nennt zwischen 1 und ${String(contractorBounds.takeover)} Namen, jeden mit seiner Fremdfirma oder ohne.`,
      )
    }

    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      let firms = 0
      let named = 0

      for (const item of items as readonly { name: string; contractorId?: string | null }[]) {
        const name = item.name.trim()

        refuse(contractorProblems({ name }))

        let firmId: ContractorId

        if (typeof item.contractorId === 'string') {
          firmId = (await heldContractor(tx, item.contractorId)).id
        } else {
          const [made] = await tx
            .insert(contractors)
            .values({ tenantId: identity.tenantId, name })
            .returning({ id: contractors.id })

          if (made === undefined) {
            throw new Error('The contractor was not written')
          }

          firmId = made.id
          firms += 1
        }

        const changed = await tx
          .update(duties)
          .set({ contractorId: firmId, updatedAt: new Date() })
          .where(
            and(
              openDuty(today),
              eq(duties.performer, 'contractor'),
              isNull(duties.contractorId),
              eq(duties.performerNote, item.name),
            ),
          )
          .returning({ id: duties.id })

        named += changed.length
      }

      return { firms, duties: named }
    })
  }

  /** A firm with its open duties and activities counted, and the evidence of its reports, newest first. */
  @Get(':id')
  @RequiresPermission('contractor.read')
  page(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<ContractorPage> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const [row] = isUuid(id)
        ? await tx
            .select()
            .from(contractors)
            .where(eq(contractors.id, id as ContractorId))
        : []

      // A removed firm keeps its page, so that a link from a duty or an evidence leads somewhere.
      if (row === undefined) {
        throw new NotFoundException(missing)
      }

      const [{ open: openDuties = 0 } = {}] = await tx
        .select({ open: count() })
        .from(duties)
        .where(and(openDuty(today), eq(duties.contractorId, row.id)))
      const [{ open: openActivities = 0 } = {}] = await tx
        .select({ open: count() })
        .from(activities)
        .where(and(openActivity, eq(activities.contractorId, row.id)))
      const written = await tx
        .select({
          id: evidence.id,
          number: evidence.number,
          performedOn: evidence.performedOn,
          result: evidence.result,
          examinerOrganisation: evidence.examinerOrganisation,
          duty: duties,
        })
        .from(evidence)
        .innerJoin(duties, eq(duties.id, evidence.dutyId))
        .where(eq(evidence.contractorId, row.id))
        .orderBy(desc(evidence.performedOn), desc(evidence.writtenAt))
        .limit(contractorBounds.evidence)

      return {
        contractor: row,
        openDuties,
        openActivities,
        evidence: written.map((each) => ({
          id: each.id,
          number: each.number,
          dutyTitle: dutyTitle(each.duty, this.catalogue),
          performedOn: each.performedOn as IsoDate,
          result: each.result,
          examinerOrganisation: each.examinerOrganisation,
        })),
      }
    })
  }

  @Post()
  @RequiresPermission('contractor.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Contractor> {
    const values = contractorValues(body, true)

    return this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .insert(contractors)
        .values({ ...(values as typeof contractors.$inferInsert), tenantId: identity.tenantId })
        .returning()

      if (row === undefined) {
        throw new Error('The contractor was not written')
      }

      return row
    })
  }

  @Patch(':id')
  @RequiresPermission('contractor.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Contractor> {
    const values = contractorValues(body, false)

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldContractor(tx, id)
      const [row] = await tx
        .update(contractors)
        .set({ ...(values as Partial<typeof contractors.$inferInsert>), updatedAt: new Date() })
        .where(eq(contractors.id, held.id))
        .returning()

      return row ?? held
    })
  }

  /**
   * A firm that no longer works for the operator: marked, never removed, and
   * readable wherever it is named. Refused while an open duty or an activity
   * still to be done names it, which then has to name another firm first.
   */
  @Delete(':id')
  @RequiresPermission('contractor.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldContractor(tx, id)
      // Counted where the person sees: the roles that keep the firms see every area.
      const [{ open: openDuties = 0 } = {}] = await tx
        .select({ open: count() })
        .from(duties)
        .where(and(openDuty(today), eq(duties.contractorId, held.id)))
      const [{ open: openActivities = 0 } = {}] = await tx
        .select({ open: count() })
        .from(activities)
        .where(and(openActivity, eq(activities.contractorId, held.id)))

      if (openDuties > 0 || openActivities > 0) {
        throw new ConflictException(
          `Die Fremdfirma lässt sich nicht entfernen, solange ${String(openDuties)} offene Pflichten und ${String(openActivities)} offene Vorgänge sie nennen. Wählen Sie dort eine andere Firma oder die eigenen Leute.`,
        )
      }

      await tx.update(contractors).set({ deletedAt: new Date() }).where(eq(contractors.id, held.id))
    })
  }
}
