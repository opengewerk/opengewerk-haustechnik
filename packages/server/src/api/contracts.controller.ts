import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
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
  type AssetContract,
  type AssetId,
  type BuildingId,
  byNameIn,
  type Catalogue,
  type Contract,
  contractBounds,
  type ContractEntry,
  type ContractId,
  type ContractItem,
  type ContractorId,
  type ContractPage,
  contractProblems,
  contractStanding,
  contractStandingLabel,
  contractTermProblems,
  dayInWords,
  type IsoDate,
  isAllowed,
  noticeBy,
  noticeWords,
  termEnd,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, count, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import {
  assets,
  buildings,
  contractItems,
  contractors,
  contracts,
  duties,
  properties,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { checkContractor } from './contractor-checks.js'
import { registeredEntries } from './duty-register.js'
import { type Asking, fieldsOf, refuse, seesEveryAreaNow } from './places.js'

const missing = 'Diesen Vertrag gibt es nicht oder nicht mehr.'

/** The texts and days of a contract that may be emptied. */
const emptiable = ['endsOn', 'cancelledTo', 'responseTime', 'price', 'note', 'noticeUnit'] as const

/** The fields a body may send for a contract. */
const fields = [
  'contractorId',
  'title',
  'startsOn',
  'endsOn',
  'renewalMonths',
  'noticeAmount',
  'noticeUnit',
  'cancelledTo',
  'responseTime',
  'price',
  'note',
] as const

/** The fields of a contract as a body sends them, judged one by one; how they go together is asked of the whole. */
function contractValues(body: unknown, creating: boolean): Record<string, unknown> {
  const values = fieldsOf(body, fields, emptiable)

  // A number left empty in a form comes as null or as an empty text.
  for (const field of ['renewalMonths', 'noticeAmount'] as const) {
    if (values[field] === '') {
      values[field] = null
    }
  }

  if (creating) {
    values.title ??= ''
    values.startsOn ??= ''
  }

  refuse(contractProblems(values))

  if (creating && (typeof values.contractorId !== 'string' || values.contractorId === '')) {
    throw new BadRequestException('Ein Vertrag ist ein Vertrag mit einer Fremdfirma der Liste.')
  }

  return values
}

/** A live contract of the tenant, or the refusal that it is not there. */
async function heldContract(
  tx: TenantTransaction,
  id: string,
): Promise<typeof contracts.$inferSelect> {
  const [row] = isUuid(id)
    ? await tx
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, id as ContractId), isNull(contracts.deletedAt)))
    : []

  if (row === undefined) {
    throw new NotFoundException(missing)
  }

  return row
}

/**
 * What a route answers whoever keeps the contracts in some areas only. A
 * contract lies in no area, the duties that name it do; what reaches past the
 * own areas, removing a contract or giving it to another firm, is for whoever
 * sees all of them, so that what is counted for it is everything there is.
 */
const everyAreaWanted =
  'Einen Vertrag entfernen oder einer anderen Fremdfirma geben kann nur, wer alle Bereiche sieht: Pflichten in jedem Bereich können ihn nennen.'

/** A duty that still calls for something on a day: not removed and not ended. */
function openDuty(on: IsoDate): SQL | undefined {
  return and(isNull(duties.deletedAt), or(isNull(duties.endsOn), gt(duties.endsOn, on)))
}

/** How many buildings and assets each contract covers, counted in the areas the person sees. */
async function coveredOf(
  tx: TenantTransaction,
): Promise<ReadonlyMap<string, { buildings: number; assets: number }>> {
  const rows = await tx.select().from(contractItems)
  const counted = new Map<string, { buildings: number; assets: number }>()

  for (const row of rows) {
    const held = counted.get(row.contractId) ?? { buildings: 0, assets: 0 }

    counted.set(row.contractId, {
      buildings: held.buildings + (row.buildingId === null ? 0 : 1),
      assets: held.assets + (row.assetId === null ? 0 : 1),
    })
  }

  return counted
}

/** A contract as the list says it on a day: its firm, what it covers, and how it stands. */
function entryOf(
  contract: Contract,
  contractorName: string,
  covered: { buildings: number; assets: number } | undefined,
  today: IsoDate,
): ContractEntry {
  return {
    ...contract,
    contractorName,
    buildings: covered?.buildings ?? 0,
    assets: covered?.assets ?? 0,
    runsUntil: termEnd(contract, today),
    noticeBy: noticeBy(contract, today),
    standing: contractStanding(contract, today),
  }
}

/** The live contracts with their firms, by their title, narrowed to one firm where a query names it. */
async function entries(
  tx: TenantTransaction,
  today: IsoDate,
  contractorId: unknown,
): Promise<ContractEntry[]> {
  if (contractorId !== undefined && (typeof contractorId !== 'string' || !isUuid(contractorId))) {
    return []
  }

  const covered = await coveredOf(tx)
  const rows = await tx
    .select({ contract: contracts, contractorName: contractors.name })
    .from(contracts)
    .innerJoin(contractors, eq(contractors.id, contracts.contractorId))
    .where(
      and(
        isNull(contracts.deletedAt),
        contractorId === undefined
          ? undefined
          : eq(contracts.contractorId, contractorId as ContractorId),
      ),
    )

  return rows
    .sort((left, right) => byNameIn(left.contract.title, right.contract.title))
    .map((row) => entryOf(row.contract, row.contractorName, covered.get(row.contract.id), today))
}

/**
 * The contracts of an operator with its contractors (#329, section 4.11 of
 * the concept): the Leitung, the Technische Leitung and the Objektleitung
 * read them, the Leitung and the Technische Leitung keep them (decided
 * 15.10.2026). A contract lies in no area; what it covers is read from the
 * areas of the person only, by the policy of its rows. One entered by
 * mistake is marked when it is removed, and that is refused while an open
 * duty names it.
 */
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** Every live contract by its title, `?contractorId=` those of one firm. */
  @Get()
  @RequiresPermission('contract.read')
  list(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<ContractEntry[]> {
    const today = dayInGermany()

    return this.database.forTenant(identity, (tx) => entries(tx, today, query['contractorId']))
  }

  /** The live contracts as a table, `?format=xlsx` or `csv`, as the list shows them. */
  @Get('table')
  @RequiresPermission('contract.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        {
          name: 'Verträge',
          columns: [
            'Vertrag',
            'Fremdfirma',
            'Beginn',
            'Läuft bis',
            'Kündigungsfrist',
            'Kündigung bis',
            'Stand',
            'Gebäude',
            'Anlagen',
            'Reaktionszeit',
            'Preis',
          ],
          rows: (await entries(tx, today, undefined)).map((entry) => [
            entry.title,
            entry.contractorName,
            dayInWords(entry.startsOn),
            entry.runsUntil === null ? null : dayInWords(entry.runsUntil),
            noticeWords(entry),
            entry.noticeBy === null ? null : dayInWords(entry.noticeBy),
            contractStandingLabel[entry.standing],
            entry.buildings,
            entry.assets,
            entry.responseTime,
            entry.price,
          ]),
        },
        format,
        today,
      ),
    )
  }

  /**
   * The contracts that cover an asset (4.2, #329): the asset itself, or the
   * building it stands in. Only an asset the person sees has any.
   */
  @Get('at-asset/:assetId')
  @RequiresPermission('contract.read')
  atAsset(
    @CurrentIdentity() identity: Asking,
    @Param('assetId') assetId: string,
  ): Promise<AssetContract[]> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const [asset] = isUuid(assetId)
        ? await tx
            .select({ id: assets.id, buildingId: assets.buildingId })
            .from(assets)
            .where(eq(assets.id, assetId as AssetId))
        : []

      if (asset === undefined) {
        return []
      }

      const rows = await tx
        .select({
          contract: contracts,
          contractorName: contractors.name,
          assetId: contractItems.assetId,
        })
        .from(contractItems)
        .innerJoin(contracts, eq(contracts.id, contractItems.contractId))
        .innerJoin(contractors, eq(contractors.id, contracts.contractorId))
        .where(
          and(
            isNull(contracts.deletedAt),
            or(eq(contractItems.assetId, asset.id), eq(contractItems.buildingId, asset.buildingId)),
          ),
        )
        .limit(contractBounds.atAnAsset)
      const byContract = new Map<string, AssetContract>()

      for (const row of rows) {
        const before = byContract.get(row.contract.id)
        const direct = row.assetId !== null

        byContract.set(row.contract.id, {
          id: row.contract.id,
          title: row.contract.title,
          contractorName: row.contractorName,
          // Covered by itself as well as through its building: by itself.
          throughBuilding: !direct && (before?.throughBuilding ?? true),
          runsUntil: termEnd(row.contract, today),
          standing: contractStanding(row.contract, today),
        })
      }

      return [...byContract.values()].sort((left, right) => byNameIn(left.title, right.title))
    })
  }

  /**
   * A contract as its list says it, what it covers in the areas of the
   * person, and the duties it fulfils that the person sees.
   */
  @Get(':id')
  @RequiresPermission('contract.read')
  page(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<ContractPage> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const [row] = isUuid(id)
        ? await tx
            .select({ contract: contracts, contractorName: contractors.name })
            .from(contracts)
            .innerJoin(contractors, eq(contractors.id, contracts.contractorId))
            .where(eq(contracts.id, id as ContractId))
        : []

      // A removed contract keeps its page, so that a link from a duty or a document leads somewhere.
      if (row === undefined) {
        throw new NotFoundException(missing)
      }

      const covered = await coveredOf(tx)
      const items = await tx
        .select({
          id: contractItems.id,
          buildingId: contractItems.buildingId,
          assetId: contractItems.assetId,
          assetNumber: assets.number,
          assetName: assets.name,
          buildingName: buildings.name,
          propertyName: properties.name,
        })
        .from(contractItems)
        .innerJoin(properties, eq(properties.id, contractItems.propertyId))
        .leftJoin(assets, eq(assets.id, contractItems.assetId))
        .leftJoin(
          buildings,
          or(eq(buildings.id, contractItems.buildingId), eq(buildings.id, assets.buildingId)),
        )
        .where(eq(contractItems.contractId, row.contract.id))
        .limit(contractBounds.items)
      // An asset it covers only for whoever sees the assets (section 7).
      const seesAssets = isAllowed(identity, 'asset.read')
      const named: ContractItem[] = items
        .filter((item) => seesAssets || item.assetId === null)
        .map((item): ContractItem => {
          const asset = item.assetId !== null

          return {
            id: item.id,
            kind: asset ? 'asset' : 'building',
            buildingId: item.buildingId,
            assetId: item.assetId,
            name: asset
              ? [item.assetNumber, item.assetName].filter(Boolean).join(' ')
              : (item.buildingName ?? ''),
            where: asset
              ? [item.propertyName, item.buildingName].filter(Boolean).join(', ')
              : item.propertyName,
          }
        })
        // The buildings first, then the assets, each by name.
        .sort(
          (left, right) =>
            Number(left.kind === 'asset') - Number(right.kind === 'asset') ||
            byNameIn(left.name, right.name),
        )
      // The duties it fulfils only for whoever reads the duties (section 7).
      const fulfilled = isAllowed(identity, 'duty.read')
        ? ((await registeredEntries(tx, this.catalogue, today, { contractId: row.contract.id })) ??
          [])
        : []

      return {
        contract: entryOf(row.contract, row.contractorName, covered.get(row.contract.id), today),
        items: named,
        duties: fulfilled
          .filter((duty) => !duty.ended)
          .map((duty) => ({
            id: duty.id,
            title: duty.title,
            state: duty.state,
            appointment: duty.appointment,
            ended: duty.ended,
            contractEnded: duty.contractEnded,
            propertyId: duty.propertyId,
            buildingId: duty.buildingId,
            roomId: duty.roomId,
            asset: duty.asset,
          })),
      }
    })
  }

  @Post()
  @RequiresPermission('contract.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Contract> {
    const values = contractValues(body, true)

    return this.database.forTenant(identity, async (tx) => {
      await checkContractor(tx, values['contractorId'])

      const whole = {
        startsOn: values['startsOn'] as IsoDate,
        endsOn: (values['endsOn'] ?? null) as IsoDate | null,
        renewalMonths: (values['renewalMonths'] ?? null) as number | null,
        noticeAmount: (values['noticeAmount'] ?? null) as number | null,
        noticeUnit: (values['noticeUnit'] ?? null) as Contract['noticeUnit'],
        cancelledTo: (values['cancelledTo'] ?? null) as IsoDate | null,
      }

      refuse(contractTermProblems(whole))

      const [row] = await tx
        .insert(contracts)
        .values({ ...(values as typeof contracts.$inferInsert), tenantId: identity.tenantId })
        .returning()

      if (row === undefined) {
        throw new Error('The contract was not written')
      }

      return row
    })
  }

  @Patch(':id')
  @RequiresPermission('contract.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Contract> {
    const values = contractValues(body, false)

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldContract(tx, id)

      if (values['contractorId'] !== undefined && values['contractorId'] !== held.contractorId) {
        await checkContractor(tx, values['contractorId'])

        // Another firm: the duties it names keep theirs, so none may name it.
        if (!(await seesEveryAreaNow(tx))) {
          throw new ForbiddenException(everyAreaWanted)
        }

        const [{ naming = 0 } = {}] = await tx
          .select({ naming: count() })
          .from(duties)
          .where(eq(duties.contractId, held.id))

        if (naming > 0) {
          throw new ConflictException(
            'Die Fremdfirma eines Vertrags lässt sich nicht ändern, solange Pflichten ihn nennen. Legen Sie für die andere Firma einen eigenen Vertrag an.',
          )
        }
      }

      refuse(contractTermProblems({ ...held, ...(values as Partial<Contract>) }))

      const [row] = await tx
        .update(contracts)
        .set({ ...(values as Partial<typeof contracts.$inferInsert>), updatedAt: new Date() })
        .where(eq(contracts.id, held.id))
        .returning()

      return row ?? held
    })
  }

  /**
   * A contract entered by mistake: marked, never removed, and its documents
   * with it. Refused while an open duty names it, which then has to name
   * another contract or none first. One that has ended stays, and its duties
   * say so.
   */
  @Delete(':id')
  @RequiresPermission('contract.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldContract(tx, id)

      // Counted in every area, which only whoever sees all of them does.
      if (!(await seesEveryAreaNow(tx))) {
        throw new ForbiddenException(everyAreaWanted)
      }

      const [{ open = 0 } = {}] = await tx
        .select({ open: count() })
        .from(duties)
        .where(and(openDuty(today), eq(duties.contractId, held.id)))

      if (open > 0) {
        throw new ConflictException(
          `Der Vertrag lässt sich nicht entfernen, solange ${String(open)} offene Pflichten ihn nennen. Wählen Sie dort einen anderen Vertrag oder keinen.`,
        )
      }

      await tx.update(contracts).set({ deletedAt: new Date() }).where(eq(contracts.id, held.id))
    })
  }

  /**
   * Covering a building whole or an asset, `{ buildingId }` or `{ assetId }`:
   * one the person sees, each once to a contract.
   */
  @Post(':id/items')
  @RequiresPermission('contract.write')
  cover(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    const { buildingId, assetId } = fieldsOf(body, ['buildingId', 'assetId'] as const)
    const named = [buildingId, assetId].filter((value) => value !== undefined && value !== null)

    if (named.length !== 1 || typeof named[0] !== 'string' || !isUuid(named[0])) {
      throw new BadRequestException('Ein Vertrag erfasst ein Gebäude oder eine Anlage.')
    }

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldContract(tx, id)
      const [place] =
        buildingId !== undefined && buildingId !== null
          ? await tx
              .select({ propertyId: buildings.propertyId, areaId: buildings.areaId })
              .from(buildings)
              .where(and(eq(buildings.id, buildingId as BuildingId), isNull(buildings.deletedAt)))
          : await tx
              .select({ propertyId: assets.propertyId, areaId: assets.areaId })
              .from(assets)
              .where(and(eq(assets.id, assetId as AssetId), isNull(assets.deletedAt)))

      if (place === undefined) {
        throw new BadRequestException(
          'Dieses Gebäude oder diese Anlage gibt es nicht oder nicht in Ihren Bereichen.',
        )
      }

      const [already] = await tx
        .select({ id: contractItems.id })
        .from(contractItems)
        .where(
          and(
            eq(contractItems.contractId, held.id),
            buildingId !== undefined && buildingId !== null
              ? eq(contractItems.buildingId, buildingId as BuildingId)
              : eq(contractItems.assetId, assetId as AssetId),
          ),
        )

      if (already !== undefined) {
        return already
      }

      const [row] = await tx
        .insert(contractItems)
        .values({
          tenantId: identity.tenantId,
          contractId: held.id,
          propertyId: place.propertyId,
          areaId: place.areaId,
          buildingId: (buildingId ?? null) as BuildingId | null,
          assetId: (assetId ?? null) as AssetId | null,
        })
        .returning({ id: contractItems.id })

      if (row === undefined) {
        throw new Error('The item was not written')
      }

      return row
    })
  }

  /** Taking a building or an asset out of what a contract covers. */
  @Delete(':id/items/:itemId')
  @RequiresPermission('contract.write')
  uncover(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      const held = await heldContract(tx, id)
      const taken = isUuid(itemId)
        ? await tx
            .delete(contractItems)
            .where(
              and(
                eq(contractItems.id, itemId as (typeof contractItems.$inferSelect)['id']),
                eq(contractItems.contractId, held.id),
              ),
            )
            .returning({ id: contractItems.id })
        : []

      if (taken.length === 0) {
        throw new NotFoundException('Das erfasst dieser Vertrag nicht oder nicht mehr.')
      }
    })
  }
}

/** The contracts named by these ids that are live, for a duty that names one (#329). */
export async function liveContractsOf(
  tx: TenantTransaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, typeof contracts.$inferSelect>> {
  const valid = ids.filter((id) => isUuid(id))

  if (valid.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select()
    .from(contracts)
    .where(and(inArray(contracts.id, valid as ContractId[]), isNull(contracts.deletedAt)))

  return new Map(rows.map((row) => [row.id as string, row]))
}
