import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  type Catalogue,
  type ChoiceOption,
  type ExpectedDocument,
  expectedDocumentsProblem,
  freeKey,
  isOwnKind,
  type OwnAssetField,
  type OwnAssetKind,
  type OwnExpectedDocument,
  ownFieldPrefix,
  ownFieldProblems,
  type OwnFieldSort,
  ownKeyStem,
  ownKindLimits,
  ownKindProblems,
  type OwnKindsReading,
  ownPackage,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { ownAssetFields, ownAssetKinds } from '../database/schema/index.js'
import { changingOwnKinds, ownOf, tenantCatalogue } from '../own-kinds/catalogue.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, refuse, seesEveryAreaNow } from './places.js'

const kindGone = 'Diese eigene Anlagenart gibt es nicht.'
const fieldGone = 'Diese eigene Angabe gibt es nicht.'

/**
 * What removing a kind, a field or a choice of one answers whoever keeps the
 * kinds in some areas only (#474): an asset in every area may carry it, and
 * what is counted for it is everything there is.
 */
const everyAreaWanted =
  'Eine eigene Anlagenart, eine eigene Angabe oder eine Auswahl daran entfernen kann nur, wer alle Bereiche sieht: Anlagen in jedem Bereich können sie tragen.'

/** The same for the sort of a field, which changes only while no asset in any area holds a value of it (#529). */
const sortWanted =
  'Die Sorte einer eigenen Angabe ändert nur, wer alle Bereiche sieht: Anlagen in jedem Bereich können einen Wert von ihr haben.'

/** How many assets carry each own kind and hold a value of each own field. */
interface Uses {
  readonly assets: ReadonlyMap<string, number>
  readonly values: ReadonlyMap<
    string,
    { readonly held: number; readonly choices: readonly string[] }
  >
}

/**
 * The same counts as `own_kind_uses()` (migration 0079), asked as the person:
 * the assets in their areas and no other (#474).
 */
const usesInSight = sql`
  select k.key as asset_kind, null::text as field_key,
         (select count(*)::integer from assets a where a.kind = k.key) as assets,
         null::text[] as held
    from own_asset_kinds k
   where k.deleted_at is null
  union all
  select f.asset_kind, f.key, count(a.id)::integer,
         case when f.sort = 'choice'
              then array_remove(array_agg(distinct a."values" ->> f.key), null)
         end
    from own_asset_fields f
    left join assets a on a.kind = f.asset_kind and a."values" ? f.key
   where f.deleted_at is null
   group by f.asset_kind, f.key, f.sort`

/**
 * Past the areas, asked of the database as its owner (`own_kind_uses()`,
 * migration 0079): an asset in an area of somebody else carries a kind as
 * well, and a kind or a field goes only while none does. That is for whoever
 * sees every area; anybody else is counted the assets in their own areas.
 * Counts and the codes of choices, nothing an asset says.
 */
async function usesOf(tx: TenantTransaction, everyArea: boolean): Promise<Uses> {
  const result = await tx.execute(
    everyArea ? sql`select asset_kind, field_key, assets, held from own_kind_uses()` : usesInSight,
  )
  const rows = result.rows as {
    asset_kind: string
    field_key: string | null
    assets: number
    held: string[] | null
  }[]
  const assets = new Map<string, number>()
  const values = new Map<string, { held: number; choices: readonly string[] }>()

  for (const row of rows) {
    if (row.field_key === null) {
      assets.set(row.asset_kind, row.assets)
    } else {
      values.set(row.field_key, { held: row.assets, choices: row.held ?? [] })
    }
  }

  return { assets, values }
}

/** "1 Anlage", "4 Anlagen". */
function assetsWords(count: number): string {
  return count === 1 ? '1 Anlage' : `${String(count)} Anlagen`
}

/**
 * The choices of a choice as the dialog sends them, one label each, with the
 * values they keep: a label that is there already keeps its value, a new one
 * gets the next.
 */
function choicesFrom(labels: readonly string[], before: readonly ChoiceOption[]): ChoiceOption[] {
  const held = new Map(before.map((option) => [option.label.toLowerCase(), option.value]))
  let next =
    Math.max(0, ...before.map((option) => Number.parseInt(option.value.slice(1), 10) || 0)) + 1

  return labels.map((label) => {
    const value = held.get(label.toLowerCase())

    if (value !== undefined) {
      return { value, label }
    }

    const made = `o${String(next)}`

    next += 1

    return { value: made, label }
  })
}

/** The documents an own kind expects, each with a key made of its label and kept where it had one. */
function documentsFrom(given: readonly OwnExpectedDocument[]): ExpectedDocument[] {
  const taken = new Set<string>()

  return given.map((document) => {
    const label = document.label.trim()
    const key =
      typeof document.key === 'string' && /^[a-z0-9_]{1,60}$/u.test(document.key)
        ? document.key
        : freeKey('', ownKeyStem(label), taken)

    taken.add(key)

    const source = document.demand === 'required' ? (document.source ?? '').trim() : null

    return { key, label, kind: document.kind, demand: document.demand, source }
  })
}

/**
 * The asset kinds and fields of the operator's own (#62, sections 2.5 and 4.2
 * of the concept): read with what uses them, made, changed and removed by
 * whoever may "Eigene Anlagenarten und Felder führen", the Leitung and the
 * Technische Leitung (decided on 15.10.2026).
 *
 * Everybody else reads them where they are used: in the catalogue a device
 * holds, which the server hands out with them, on the form of an asset and in
 * its file. The counts here look past the areas, because they decide what
 * may go; they are no more than counts, and only whoever sees every area is
 * given them and removes a kind, a field or a choice (#474).
 */
@Controller('own-kinds')
export class OwnKindsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** Every own kind with its fields, and the own fields at kinds of packages, each with what uses it. */
  @Get()
  @RequiresPermission('kind.write')
  list(@CurrentIdentity() identity: Asking): Promise<OwnKindsReading> {
    return this.database.forTenant(identity, async (tx) => {
      const { kinds, fields } = await ownOf(tx)
      const uses = await usesOf(tx, await seesEveryAreaNow(tx))
      const counted = (field: OwnAssetField) => ({
        ...field,
        values: uses.values.get(field.key)?.held ?? 0,
      })
      const own = new Set(kinds.map((kind) => kind.key))

      return {
        kinds: kinds.map((kind) => ({
          ...kind,
          assets: uses.assets.get(kind.key) ?? 0,
          fields: fields.filter((field) => field.assetKind === kind.key).map(counted),
        })),
        fields: fields.filter((field) => !own.has(field.assetKind)).map(counted),
      }
    })
  }

  /** A kind of the operator's own, with a key made of its label that no other kind has had. */
  @Post()
  @RequiresPermission('kind.write')
  make(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<OwnAssetKind> {
    const said = fieldsOf(body, ['label', 'costGroup'] as const)

    return this.database.forTenant(identity, async (tx) => {
      refuse(ownKindProblems({ label: null, costGroup: null, ...said }, this.costGroups()))

      const taken = await tx.select({ key: ownAssetKinds.key }).from(ownAssetKinds)

      if (taken.length >= ownKindLimits.kinds) {
        throw new BadRequestException(
          `Ein Betreiber führt höchstens ${String(ownKindLimits.kinds)} eigene Anlagenarten.`,
        )
      }

      const key = freeKey(
        `${ownPackage}.`,
        ownKeyStem(said.label as string),
        new Set(taken.map((row) => row.key)),
      )
      const [made] = await tx
        .insert(ownAssetKinds)
        .values({
          tenantId: identity.tenantId,
          key,
          label: said.label as string,
          costGroup: said.costGroup as string,
        })
        .returning()

      return kindOf(made as typeof ownAssetKinds.$inferSelect)
    })
  }

  /**
   * What a kind is called, its cost group and the documents it expects; its
   * key stays. Every change counts its version up, as a new version of a
   * package does, and the values an asset holds stay as they are.
   */
  @Patch(':id')
  @RequiresPermission('kind.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnAssetKind> {
    const said = fieldsOf(body, ['label', 'costGroup', 'expectedDocuments'] as const)

    if (Object.keys(said).length === 0) {
      throw new BadRequestException('Es wurde nichts geändert.')
    }

    return this.database.forTenant(identity, async (tx) => {
      refuse(ownKindProblems(said, this.costGroups()))

      if (said.expectedDocuments !== undefined) {
        const problem = expectedDocumentsProblem(said.expectedDocuments)

        if (problem !== null) {
          throw new BadRequestException(problem)
        }
      }

      const kind = await this.kindAt(tx, id)
      const [changed] = await tx
        .update(ownAssetKinds)
        .set({
          ...(said.label === undefined ? {} : { label: said.label as string }),
          ...(said.costGroup === undefined ? {} : { costGroup: said.costGroup as string }),
          ...(said.expectedDocuments === undefined
            ? {}
            : {
                expectedDocuments: documentsFrom(said.expectedDocuments as OwnExpectedDocument[]),
              }),
          revision: kind.revision + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(ownAssetKinds.id, kind.id))
        .returning()

      return kindOf(changed as typeof ownAssetKinds.$inferSelect)
    })
  }

  /** A kind no asset carries, removed by marking it, with its fields. Its key stays taken. */
  @Delete(':id')
  @HttpCode(200)
  @RequiresPermission('kind.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      // Before it reads anything, so that no asset takes the kind meanwhile (#529).
      await changingOwnKinds(tx)

      const kind = await this.kindAt(tx, id)

      if (!(await seesEveryAreaNow(tx))) {
        throw new ForbiddenException(everyAreaWanted)
      }

      const carrying = (await usesOf(tx, true)).assets.get(kind.key) ?? 0

      if (carrying > 0) {
        throw new ConflictException(
          `Die Anlagenart tragen noch ${assetsWords(carrying)}. Entfernt wird sie, solange keine Anlage sie trägt.`,
        )
      }

      await tx
        .update(ownAssetFields)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(ownAssetFields.assetKind, kind.key), isNull(ownAssetFields.deletedAt)))
      await tx
        .update(ownAssetKinds)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(ownAssetKinds.id, kind.id))
    })
  }

  /**
   * A field of the operator's own at a kind of its own or of a package, after
   * the fields it has; its key is made of its label and is one per operator.
   */
  @Post('fields')
  @RequiresPermission('kind.write')
  addField(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<OwnAssetField> {
    const said = fieldsOf(body, ['assetKind', 'label', 'sort', 'unit', 'options'] as const, [
      'unit',
    ])

    // A choice without choices is asked about as one with none.
    refuse(
      ownFieldProblems({
        label: null,
        sort: null,
        ...(said.sort === 'choice' ? { options: [] } : {}),
        ...said,
      }),
    )

    return this.database.forTenant(identity, async (tx) => {
      const kind = typeof said.assetKind === 'string' ? said.assetKind : ''
      const catalogue = await tenantCatalogue(tx, this.catalogue)

      if (catalogue.assetKind(kind, dayInGermany()) === null) {
        throw new BadRequestException(`Die Anlagenart ${kind} kennt der Katalog nicht.`)
      }

      const taken = await tx
        .select({
          key: ownAssetFields.key,
          assetKind: ownAssetFields.assetKind,
          deletedAt: ownAssetFields.deletedAt,
        })
        .from(ownAssetFields)
      const atTheKind = taken.filter((row) => row.assetKind === kind && row.deletedAt === null)

      if (atTheKind.length >= ownKindLimits.fields) {
        throw new BadRequestException(
          `Eine Anlagenart hat höchstens ${String(ownKindLimits.fields)} eigene Angaben.`,
        )
      }

      const sort = said.sort as OwnFieldSort
      const [made] = await tx
        .insert(ownAssetFields)
        .values({
          tenantId: identity.tenantId,
          assetKind: kind,
          key: freeKey(
            ownFieldPrefix,
            ownKeyStem(said.label as string),
            new Set(taken.map((row) => row.key)),
          ),
          label: said.label as string,
          sort,
          unit: sort === 'number' ? ((said.unit as string | null | undefined) ?? null) : null,
          options:
            sort === 'choice'
              ? choicesFrom(
                  (said.options as string[]).map((each) => each.trim()),
                  [],
                )
              : [],
          position: atTheKind.length,
        })
        .returning()

      return fieldOf(made as typeof ownAssetFields.$inferSelect)
    })
  }

  /**
   * What a field is called, the unit of a number and the choices of a choice.
   * Its sort stays: a value an asset holds was written for it. A choice an
   * asset holds stays as well.
   */
  @Patch('fields/:id')
  @RequiresPermission('kind.write')
  changeField(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnAssetField> {
    const said = fieldsOf(body, ['label', 'sort', 'unit', 'options'] as const, ['unit'])

    if (Object.keys(said).length === 0) {
      throw new BadRequestException('Es wurde nichts geändert.')
    }

    return this.database.forTenant(identity, async (tx) => {
      // Before it reads the field, so that no asset takes a value of the sort
      // or the choice it may leave meanwhile (#529).
      await changingOwnKinds(tx)

      const field = await this.fieldAt(tx, id)
      const sort = (said.sort ?? field.sort) as OwnAssetField['sort']
      const resorted = sort !== field.sort

      refuse(ownFieldProblems({ ...said, sort }))

      // Its sort changes only while no asset holds a value of it, in any area
      // (section 2.5 of the concept, #529): a value of another sort would stand
      // at an asset that cannot read it any more.
      if (resorted) {
        // Counted past the areas of the person, so only for whoever sees them all (#474).
        if (!(await seesEveryAreaNow(tx))) {
          throw new ForbiddenException(sortWanted)
        }

        const held = (await usesOf(tx, true)).values.get(field.key)?.held ?? 0

        if (held > 0) {
          throw new ConflictException(
            `${assetsWords(held)} ${held === 1 ? 'hält' : 'halten'} einen Wert dieser Angabe. Ihre Sorte ändert sich nur, solange keine Anlage einen Wert hat.`,
          )
        }

        if (sort === 'choice' && said.options === undefined) {
          throw new BadRequestException('Eine Auswahl nennt ihre Möglichkeiten.')
        }
      }

      const options =
        said.options === undefined
          ? resorted
            ? []
            : undefined
          : choicesFrom(
              (said.options as string[]).map((each) => each.trim()),
              resorted ? [] : field.options,
            )

      if (options !== undefined) {
        const kept = new Set(options.map((option) => option.value))
        const going = field.options.filter((option) => !kept.has(option.value))

        if (going.length > 0 && !(await seesEveryAreaNow(tx))) {
          throw new ForbiddenException(everyAreaWanted)
        }

        const held =
          going.length === 0 ? [] : ((await usesOf(tx, true)).values.get(field.key)?.choices ?? [])
        const lost = going.filter((option) => held.includes(option.value))

        if (lost.length > 0) {
          throw new ConflictException(
            `Die Auswahl „${lost.map((option) => option.label).join('“, „')}“ hat eine Anlage als Wert. Sie bleibt, solange eine Anlage sie trägt.`,
          )
        }
      }

      const [changed] = await tx
        .update(ownAssetFields)
        .set({
          ...(said.label === undefined ? {} : { label: said.label as string }),
          ...(resorted ? { sort } : {}),
          ...(said.unit === undefined
            ? resorted && sort !== 'number'
              ? { unit: null }
              : {}
            : { unit: said.unit as string | null }),
          ...(options === undefined ? {} : { options }),
          updatedAt: sql`now()`,
        })
        .where(eq(ownAssetFields.id, field.id))
        .returning()

      return fieldOf(changed as typeof ownAssetFields.$inferSelect)
    })
  }

  /** A field no asset holds a value of, removed by marking it. Its key stays taken. */
  @Delete('fields/:id')
  @HttpCode(200)
  @RequiresPermission('kind.write')
  removeField(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      // Before it reads the field, so that no asset takes a value of it meanwhile (#529).
      await changingOwnKinds(tx)

      const field = await this.fieldAt(tx, id)

      if (!(await seesEveryAreaNow(tx))) {
        throw new ForbiddenException(everyAreaWanted)
      }

      const holding = (await usesOf(tx, true)).values.get(field.key)?.held ?? 0

      if (holding > 0) {
        throw new ConflictException(
          `Die Angabe hat an ${assetsWords(holding)} einen Wert. Entfernt wird sie, solange keine Anlage einen Wert von ihr hat.`,
        )
      }

      await tx
        .update(ownAssetFields)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(ownAssetFields.id, field.id))
    })
  }

  /** The cost groups the kinds of the packages name, which an own kind chooses from. */
  private costGroups(): string[] {
    return [
      ...new Set(
        this.catalogue
          .assetKinds(dayInGermany())
          .filter((entry) => !isOwnKind(entry.key))
          .map((entry) => entry.definition.costGroup),
      ),
    ]
  }

  private async kindAt(tx: TenantTransaction, id: string) {
    if (!isUuid(id)) {
      throw new NotFoundException(kindGone)
    }

    const [kind] = await tx
      .select()
      .from(ownAssetKinds)
      .where(and(eq(ownAssetKinds.id, id as never), isNull(ownAssetKinds.deletedAt)))

    if (kind === undefined) {
      throw new NotFoundException(kindGone)
    }

    return kind
  }

  private async fieldAt(tx: TenantTransaction, id: string) {
    if (!isUuid(id)) {
      throw new NotFoundException(fieldGone)
    }

    const [field] = await tx
      .select()
      .from(ownAssetFields)
      .where(and(eq(ownAssetFields.id, id as never), isNull(ownAssetFields.deletedAt)))

    if (field === undefined) {
      throw new NotFoundException(fieldGone)
    }

    return field
  }
}

function kindOf(row: typeof ownAssetKinds.$inferSelect): OwnAssetKind {
  return {
    id: String(row.id),
    key: row.key,
    label: row.label,
    costGroup: row.costGroup,
    expectedDocuments: row.expectedDocuments,
    version: row.revision,
    changedOn: dayInGermany(row.updatedAt),
  }
}

function fieldOf(row: typeof ownAssetFields.$inferSelect): OwnAssetField {
  return {
    id: String(row.id),
    assetKind: row.assetKind,
    key: row.key,
    label: row.label,
    sort: row.sort,
    unit: row.unit,
    options: row.options,
    position: row.position,
  }
}
