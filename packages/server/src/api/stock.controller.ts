import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  type Article,
  articlePriceProblem,
  belowMinimum,
  byNameIn,
  type NewStockMovement,
  type StockArticleId,
  stockArticleProblems,
  type StockLine,
  stockLevel,
  type StockMovementLine,
  stockMovementProblems,
  type StockSupplier,
  type StockSupplierId,
  stockSupplierProblems,
  type StockUnit,
  stockUnitLabel,
  type Store,
  type StoreArticlePage,
  storeArticleProblems,
  type StoreId,
  storeProblems,
  type StoreStock,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  activities,
  articles,
  stockMovements,
  storeArticles,
  stores,
  suppliers,
  workOrderMaterials,
  workOrders,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, refuse } from './places.js'

// The stores of the operator (#325, section 4.12 of the concept): articles,
// suppliers and stores, the stock of a store, the page of one article in it,
// the minimum a store keeps, and the bookings of the office, a receipt and a
// count. Tenant-wide and without an area (2.8): whoever may look at the
// stores sees all of them. A withdrawal at a work order comes with #326. An
// empty store and an article without stock are removed, and an article moves
// to another store with its stock as a transfer (#391).

const missingArticle = 'Diesen Artikel gibt es nicht oder nicht mehr.'
const missingSupplier = 'Diesen Lieferanten gibt es nicht oder nicht mehr.'
const missingStore = 'Dieses Lager gibt es nicht oder nicht mehr.'
const takenNumber = 'Diese Nummer hat schon ein anderer Artikel.'
const notCarried = 'Dieses Lager führt den Artikel nicht.'

/** The other store a transfer names, read beside the store it is booked in. */
const counterpartStores = alias(stores, 'counterpart_store')

type ArticleRow = typeof articles.$inferSelect
type SupplierRow = typeof suppliers.$inferSelect
type StoreRow = typeof stores.$inferSelect

/**
 * An article as a route hands it out. Who changed it last and from which
 * device leave the server on no route (`leftOnTheServer` of the foundation).
 */
function articleOf(row: ArticleRow): Article {
  return { ...row, unit: row.unit as StockUnit }
}

function supplierOf(row: SupplierRow): StockSupplier {
  return row
}

function storeOf(row: StoreRow): Store {
  return row
}

/** A live article of the tenant, or the refusal. */
async function heldArticle(tx: TenantTransaction, id: string): Promise<ArticleRow> {
  const [row] = isUuid(id)
    ? await tx
        .select()
        .from(articles)
        .where(and(eq(articles.id, id as StockArticleId), isNull(articles.deletedAt)))
    : []

  if (row === undefined) {
    throw new NotFoundException(missingArticle)
  }

  return row
}

async function heldSupplier(tx: TenantTransaction, id: string): Promise<SupplierRow> {
  const [row] = isUuid(id)
    ? await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id as StockSupplierId), isNull(suppliers.deletedAt)))
    : []

  if (row === undefined) {
    throw new NotFoundException(missingSupplier)
  }

  return row
}

async function heldStore(tx: TenantTransaction, id: string): Promise<StoreRow> {
  const [row] = isUuid(id)
    ? await tx
        .select()
        .from(stores)
        .where(and(eq(stores.id, id as StoreId), isNull(stores.deletedAt)))
    : []

  if (row === undefined) {
    throw new NotFoundException(missingStore)
  }

  return row
}

/** Refuses a number another live article of the tenant has, however it is written. */
async function numberIsFree(
  tx: TenantTransaction,
  number: string,
  except: string | null,
): Promise<void> {
  const [taken] = await tx
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        sql`lower(${articles.number}) = lower(${number})`,
        isNull(articles.deletedAt),
        except === null ? undefined : sql`${articles.id} <> ${except}`,
      ),
    )

  if (taken !== undefined) {
    throw new ConflictException(takenNumber)
  }
}

/** The fields of an article as a body sends them, judged; for a new one the three it must have. */
function articleValues(body: unknown, creating: boolean): Record<string, unknown> {
  const values = fieldsOf(
    body,
    ['number', 'designation', 'description', 'ean', 'unit', 'priceCents'],
    ['description', 'ean'],
  )

  if (creating) {
    for (const field of ['number', 'designation', 'unit'] as const) {
      values[field] ??= ''
    }
  }

  refuse(stockArticleProblems(values))

  const price = articlePriceProblem(values.priceCents)

  if ('priceCents' in values && price !== null) {
    throw new BadRequestException(price)
  }

  return values
}

/** The articles of the operator, kept by whoever keeps the stores (#325). */
@Controller('articles')
export class ArticlesController {
  constructor(private readonly database: Database) {}

  /** Every live article, by its number, narrowed by a search through number, designation and EAN. */
  @Get()
  @RequiresPermission('store.read')
  list(@CurrentIdentity() identity: Asking, @Query('search') search: unknown): Promise<Article[]> {
    const words = typeof search === 'string' ? search.trim().toLocaleLowerCase('de') : ''

    return this.database.forTenant(identity, async (tx) => {
      const rows = await tx.select().from(articles).where(isNull(articles.deletedAt))

      return rows
        .filter(
          (row) =>
            words === '' ||
            [row.number, row.designation, row.ean ?? ''].some((text) =>
              text.toLocaleLowerCase('de').includes(words),
            ),
        )
        .sort((left, right) => byNameIn(left.number, right.number))
        .map(articleOf)
    })
  }

  /** The live articles as a table, `?format=xlsx` or `csv`, as the list shows them. */
  @Get('table')
  @RequiresPermission('store.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const rows = (await tx.select().from(articles).where(isNull(articles.deletedAt))).sort(
        (left, right) => byNameIn(left.number, right.number),
      )

      return tableAnswer(
        {
          name: 'Artikel',
          columns: ['Nummer', 'Bezeichnung', 'EAN', 'Einheit', 'Preis in Euro'],
          rows: rows.map((row) => [
            row.number,
            row.designation,
            row.ean,
            stockUnitLabel[row.unit as StockUnit],
            row.priceCents === null ? null : row.priceCents / 100,
          ]),
        },
        format,
        today,
      )
    })
  }

  @Post()
  @RequiresPermission('store.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Article> {
    const values = articleValues(body, true)

    return this.database.forTenant(identity, async (tx) => {
      await numberIsFree(tx, String(values['number']), null)

      const [row] = await tx
        .insert(articles)
        .values({ ...(values as typeof articles.$inferInsert), tenantId: identity.tenantId })
        .returning()

      if (row === undefined) {
        throw new Error('The article was not written')
      }

      return articleOf(row)
    })
  }

  @Patch(':id')
  @RequiresPermission('store.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Article> {
    const values = articleValues(body, false)

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldArticle(tx, id)

      if (typeof values['number'] === 'string') {
        await numberIsFree(tx, values['number'], held.id)
      }

      const [row] = await tx
        .update(articles)
        .set({ ...(values as Partial<typeof articles.$inferInsert>), updatedAt: new Date() })
        .where(eq(articles.id, held.id))
        .returning()

      return articleOf(row ?? held)
    })
  }

  /**
   * An article no longer kept: marked, never removed; its bookings stay
   * readable. Only once no store holds any of it (#391): what lies somewhere
   * is counted to nothing first, so that no stock vanishes with its article.
   */
  @Delete(':id')
  @RequiresPermission('store.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      const held = await heldArticle(tx, id)
      const lying = await stockOfArticle(tx, held)

      if (lying.length > 0) {
        throw new ConflictException(
          `Der Artikel hat noch Bestand: ${lying.join(', ')}. Erst eine Zählung auf null, dann lässt er sich entfernen.`,
        )
      }

      await tx.update(articles).set({ deletedAt: new Date() }).where(eq(articles.id, held.id))
    })
  }
}

/** The fields of a supplier as a body sends them, judged. */
function supplierValues(body: unknown, creating: boolean): Record<string, unknown> {
  const texts = [
    'customerNumber',
    'email',
    'phone',
    'street',
    'houseNumber',
    'postalCode',
    'city',
    'notes',
  ] as const
  const values = fieldsOf(body, ['name', 'country', ...texts], texts)

  if (creating) {
    values.name ??= ''
  }

  refuse(stockSupplierProblems(values))

  return values
}

/** The suppliers of the operator. */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('store.read')
  list(@CurrentIdentity() identity: Asking): Promise<StockSupplier[]> {
    return this.database.forTenant(identity, async (tx) =>
      (await tx.select().from(suppliers).where(isNull(suppliers.deletedAt)))
        .sort((left, right) => byNameIn(left.name, right.name))
        .map(supplierOf),
    )
  }

  @Post()
  @RequiresPermission('store.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<StockSupplier> {
    const values = supplierValues(body, true)

    return this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .insert(suppliers)
        .values({ ...(values as typeof suppliers.$inferInsert), tenantId: identity.tenantId })
        .returning()

      if (row === undefined) {
        throw new Error('The supplier was not written')
      }

      return supplierOf(row)
    })
  }

  @Patch(':id')
  @RequiresPermission('store.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<StockSupplier> {
    const values = supplierValues(body, false)

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldSupplier(tx, id)
      const [row] = await tx
        .update(suppliers)
        .set({ ...(values as Partial<typeof suppliers.$inferInsert>), updatedAt: new Date() })
        .where(eq(suppliers.id, held.id))
        .returning()

      return supplierOf(row ?? held)
    })
  }

  @Delete(':id')
  @RequiresPermission('store.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      const held = await heldSupplier(tx, id)

      await tx.update(suppliers).set({ deletedAt: new Date() }).where(eq(suppliers.id, held.id))
    })
  }
}

/**
 * The stock of a store: every article it keeps or has bookings of, with the
 * stock its bookings make and the minimum, by the number of the article. An
 * article no longer kept stands while something of it lies there.
 */
async function stockOf(tx: TenantTransaction, store: StoreRow): Promise<StoreStock> {
  const kept = await tx
    .select({ line: storeArticles, article: articles })
    .from(storeArticles)
    .innerJoin(articles, eq(articles.id, storeArticles.articleId))
    .where(and(eq(storeArticles.storeId, store.id), isNull(storeArticles.deletedAt)))
  const booked = await tx
    .select({
      articleId: stockMovements.articleId,
      kind: stockMovements.kind,
      quantityMilli: stockMovements.quantityMilli,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .where(eq(stockMovements.storeId, store.id))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
  const lines: StockLine[] = kept
    .map(({ line, article }) => {
      const levelMilli = stockLevel(
        booked
          .filter((movement) => movement.articleId === article.id)
          .map((movement) => ({
            ...movement,
            kind: movement.kind as NewStockMovement['kind'],
          })),
      )

      return {
        articleId: article.id,
        number: article.number,
        designation: article.designation,
        unit: article.unit as StockUnit,
        levelMilli,
        minimumMilli: line.minimumMilli,
        below: article.deletedAt === null && belowMinimum(levelMilli, line.minimumMilli),
        removed: article.deletedAt !== null,
      }
    })
    .filter((line) => !line.removed || line.levelMilli !== 0)
    .sort((left, right) => byNameIn(left.number, right.number))

  return {
    storeId: store.id,
    name: store.name,
    lines,
    belowCount: lines.filter((line) => line.below).length,
  }
}

/** A quantity in thousandths as a person writes it, `85,5`. */
function quantityWords(milli: number): string {
  return (milli / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 })
}

/** The stock the bookings of one article in one store make. */
async function levelOf(
  tx: TenantTransaction,
  storeId: StoreId,
  articleId: StockArticleId,
): Promise<number> {
  const booked = await tx
    .select({
      kind: stockMovements.kind,
      quantityMilli: stockMovements.quantityMilli,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.storeId, storeId), eq(stockMovements.articleId, articleId)))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))

  return stockLevel(
    booked.map((movement) => ({ ...movement, kind: movement.kind as NewStockMovement['kind'] })),
  )
}

/** What of an article lies in the stores that hold some, "3 Stück in „Hauptlager“", by store. */
async function stockOfArticle(tx: TenantTransaction, article: ArticleRow): Promise<string[]> {
  const held = await tx
    .selectDistinct({ id: stores.id, name: stores.name })
    .from(stockMovements)
    .innerJoin(stores, eq(stores.id, stockMovements.storeId))
    .where(eq(stockMovements.articleId, article.id))
  const lying: string[] = []

  for (const store of held.sort((left, right) => byNameIn(left.name, right.name))) {
    const level = await levelOf(tx, store.id, article.id)

    if (level !== 0) {
      lying.push(
        `${quantityWords(level)} ${stockUnitLabel[article.unit as StockUnit]} in „${store.name}“`,
      )
    }
  }

  return lying
}

/**
 * Makes sure a store keeps a line for an article, which its list shows. A
 * line the article left with a move (#391) comes back with what is booked
 * there again.
 */
async function keepLine(
  tx: TenantTransaction,
  tenantId: string,
  storeId: StoreId,
  articleId: StockArticleId,
): Promise<void> {
  await tx
    .insert(storeArticles)
    .values({ tenantId: tenantId as never, storeId, articleId })
    .onConflictDoUpdate({
      target: [storeArticles.tenantId, storeArticles.storeId, storeArticles.articleId],
      set: { deletedAt: null, updatedAt: new Date() },
      setWhere: isNotNull(storeArticles.deletedAt),
    })
}

/** The stores of the operator, their stock, and the bookings of the office. */
@Controller('stores')
export class StoresController {
  constructor(private readonly database: Database) {}

  /** Every live store by its name, with how many of its articles are below their minimum. */
  @Get()
  @RequiresPermission('store.read')
  list(@CurrentIdentity() identity: Asking): Promise<(Store & { readonly belowCount: number })[]> {
    return this.database.forTenant(identity, async (tx) => {
      const rows = await tx.select().from(stores).where(isNull(stores.deletedAt))
      const listed = []

      for (const row of rows.sort((left, right) => byNameIn(left.name, right.name))) {
        listed.push({ ...storeOf(row), belowCount: (await stockOf(tx, row)).belowCount })
      }

      return listed
    })
  }

  @Post()
  @RequiresPermission('store.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Store> {
    const values = fieldsOf(body, ['name', 'location'], ['location'])

    values.name ??= ''
    refuse(storeProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .insert(stores)
        .values({ ...(values as typeof stores.$inferInsert), tenantId: identity.tenantId })
        .returning()

      if (row === undefined) {
        throw new Error('The store was not written')
      }

      return storeOf(row)
    })
  }

  @Patch(':id')
  @RequiresPermission('store.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Store> {
    const values = fieldsOf(body, ['name', 'location'], ['location'])

    refuse(storeProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const held = await heldStore(tx, id)
      const [row] = await tx
        .update(stores)
        .set({ ...(values as Partial<typeof stores.$inferInsert>), updatedAt: new Date() })
        .where(eq(stores.id, held.id))
        .returning()

      return storeOf(row ?? held)
    })
  }

  /**
   * A store no longer kept (#391): marked, never removed, and readable at its
   * bookings and the withdrawals at work orders. Only while it carries no
   * article, as its list shows it: an article that was removed and has
   * nothing there does not count.
   */
  @Delete(':id')
  @RequiresPermission('store.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<void> {
    return this.database.forTenant(identity, async (tx) => {
      const held = await heldStore(tx, id)
      const carried = (await stockOf(tx, held)).lines.length

      if (carried > 0) {
        throw new ConflictException(
          `Das Lager führt noch ${String(carried)} Artikel. Ziehen Sie sie zuerst in ein anderes Lager um oder entfernen Sie sie; einen Artikel mit Bestand bringt eine Zählung auf null.`,
        )
      }

      await tx.update(stores).set({ deletedAt: new Date() }).where(eq(stores.id, held.id))
    })
  }

  /**
   * An article moves to another store (#391), for one entered in the wrong
   * store: its stock goes along as a transfer, a booking out here and one in
   * there, each naming the other store, and its line leaves this store. The
   * other store keeps its own minimum where it carries the article already,
   * and takes the one from here where not. Without stock nothing is booked.
   */
  @Post(':id/articles/:articleId/move')
  @RequiresPermission('store.write')
  move(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Body() body: unknown,
  ): Promise<{ readonly storeId: StoreId; readonly articleId: StockArticleId }> {
    const values = fieldsOf(body, ['toStoreId', 'reason'], ['reason'])

    refuse(stockMovementProblems({ reason: values.reason ?? null }))

    return this.database.forTenant(identity, async (tx) => {
      const store = await heldStore(tx, id)
      const article = await heldArticle(tx, articleId)

      if (values.toStoreId === store.id) {
        throw new BadRequestException('Umgezogen wird in ein anderes Lager.')
      }

      const target = await heldStore(tx, String(values.toStoreId ?? ''))
      const [line] = await tx
        .select()
        .from(storeArticles)
        .where(
          and(
            eq(storeArticles.storeId, store.id),
            eq(storeArticles.articleId, article.id),
            isNull(storeArticles.deletedAt),
          ),
        )
        .for('update')

      if (line === undefined) {
        throw new NotFoundException(notCarried)
      }

      const level = await levelOf(tx, store.id, article.id)

      if (level < 0) {
        throw new ConflictException(
          'Der Bestand hier ist negativ. Erst eine Zählung, dann lässt sich der Artikel umziehen.',
        )
      }

      const reason = (values.reason ?? null) as string | null

      if (level > 0) {
        const transfer = {
          tenantId: identity.tenantId,
          articleId: article.id,
          quantityMilli: level,
          reason,
          bookedBy: identity.userId,
        }

        await tx.insert(stockMovements).values([
          { ...transfer, storeId: store.id, kind: 'transfer_out', counterpartStoreId: target.id },
          { ...transfer, storeId: target.id, kind: 'transfer_in', counterpartStoreId: store.id },
        ])
      }

      const now = new Date()

      await tx
        .update(storeArticles)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(storeArticles.id, line.id))
      await tx
        .insert(storeArticles)
        .values({
          tenantId: identity.tenantId,
          storeId: target.id,
          articleId: article.id,
          minimumMilli: line.minimumMilli,
        })
        .onConflictDoUpdate({
          target: [storeArticles.tenantId, storeArticles.storeId, storeArticles.articleId],
          set: { deletedAt: null, minimumMilli: line.minimumMilli, updatedAt: now },
          setWhere: isNotNull(storeArticles.deletedAt),
        })

      return { storeId: target.id, articleId: article.id }
    })
  }

  /** The stock of a store; with `?below=1` only what is below its minimum, the list to order from. */
  @Get(':id/stock')
  @RequiresPermission('store.read')
  stock(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query('below') below: unknown,
  ): Promise<StoreStock> {
    return this.database.forTenant(identity, async (tx) => {
      const stock = await stockOf(tx, await heldStore(tx, id))

      return below === '1' ? { ...stock, lines: stock.lines.filter((line) => line.below) } : stock
    })
  }

  /** The stock of a store as a table, `?format=xlsx` or `csv`, the list to order from with `?below=1`. */
  @Get(':id/stock/table')
  @RequiresPermission('store.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const stock = await stockOf(tx, await heldStore(tx, id))
      const only = query['below'] === '1'
      const lines = only ? stock.lines.filter((line) => line.below) : stock.lines

      return tableAnswer(
        {
          name: only ? `Bestellliste ${stock.name}` : `Lager ${stock.name}`,
          columns: ['Nummer', 'Artikel', 'Einheit', 'Bestand', 'Mindestbestand', 'Fehlt'],
          rows: lines.map((line) => [
            line.number,
            line.designation,
            stockUnitLabel[line.unit],
            line.levelMilli / 1000,
            line.minimumMilli === null ? null : line.minimumMilli / 1000,
            line.below && line.minimumMilli !== null
              ? (line.minimumMilli - line.levelMilli) / 1000
              : null,
          ]),
        },
        format,
        today,
      )
    })
  }

  /** One article in a store: its stock, the minimum, and every booking with the stock after it, the newest first. */
  @Get(':id/articles/:articleId')
  @RequiresPermission('store.read')
  article(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('articleId') articleId: string,
  ): Promise<StoreArticlePage> {
    return this.database.forTenant(identity, async (tx) => {
      const store = await heldStore(tx, id)
      const [article] = isUuid(articleId)
        ? await tx
            .select()
            .from(articles)
            .where(eq(articles.id, articleId as StockArticleId))
        : []

      if (article === undefined) {
        throw new NotFoundException(missingArticle)
      }

      const [line] = await tx
        .select()
        .from(storeArticles)
        .where(and(eq(storeArticles.storeId, store.id), eq(storeArticles.articleId, article.id)))
      // A withdrawal names its work order where the person asking sees it:
      // the withdrawal lies in the area of the order (#326).
      const movements = await tx
        .select({
          movement: stockMovements,
          supplier: suppliers.name,
          counterpart: { id: counterpartStores.id, name: counterpartStores.name },
          material: workOrderMaterials.activityId,
          order: { id: activities.id, title: activities.title, number: workOrders.number },
        })
        .from(stockMovements)
        .leftJoin(suppliers, eq(suppliers.id, stockMovements.supplierId))
        .leftJoin(counterpartStores, eq(counterpartStores.id, stockMovements.counterpartStoreId))
        .leftJoin(workOrderMaterials, eq(workOrderMaterials.id, stockMovements.materialId))
        .leftJoin(activities, eq(activities.id, workOrderMaterials.activityId))
        .leftJoin(workOrders, eq(workOrders.activityId, activities.id))
        .where(and(eq(stockMovements.storeId, store.id), eq(stockMovements.articleId, article.id)))
        .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
      let level = 0
      const lines: StockMovementLine[] = movements.map(
        ({ movement, supplier, counterpart, order }) => {
          level = stockLevel([
            { kind: 'count', quantityMilli: level, createdAt: new Date(0) },
            { ...movement, kind: movement.kind as NewStockMovement['kind'] },
          ])

          return {
            id: movement.id,
            kind: movement.kind as StockMovementLine['kind'],
            quantityMilli: movement.quantityMilli,
            levelAfterMilli: level,
            bookedOn: dayInGermany(movement.createdAt),
            supplier,
            reason: movement.reason,
            counterpartStore:
              counterpart === null || counterpart.id === null
                ? null
                : { id: counterpart.id, name: counterpart.name },
            workOrder:
              movement.materialId === null
                ? null
                : {
                    id: order?.id ?? null,
                    number: order?.number ?? null,
                    title: order?.title ?? null,
                  },
          }
        },
      )
      const minimumMilli = line?.minimumMilli ?? null

      return {
        store: { id: store.id, name: store.name },
        article: articleOf(article),
        levelMilli: level,
        minimumMilli,
        below: article.deletedAt === null && belowMinimum(level, minimumMilli),
        carried: line !== undefined && line.deletedAt === null,
        movements: lines.reverse(),
      }
    })
  }

  /** The minimum a store keeps of an article, or none. */
  @Put(':id/articles/:articleId/minimum')
  @RequiresPermission('store.write')
  minimum(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('articleId') articleId: string,
    @Body() body: unknown,
  ): Promise<{ readonly minimumMilli: number | null }> {
    const values = fieldsOf(body, ['minimumMilli'])
    const minimumMilli = (values.minimumMilli ?? null) as number | null

    refuse(storeArticleProblems({ minimumMilli }))

    return this.database.forTenant(identity, async (tx) => {
      const store = await heldStore(tx, id)
      const article = await heldArticle(tx, articleId)

      await tx
        .insert(storeArticles)
        .values({
          tenantId: identity.tenantId,
          storeId: store.id,
          articleId: article.id,
          minimumMilli,
        })
        .onConflictDoUpdate({
          target: [storeArticles.tenantId, storeArticles.storeId, storeArticles.articleId],
          set: { minimumMilli, updatedAt: new Date() },
        })

      return { minimumMilli }
    })
  }

  /**
   * A booking of the office: a receipt, with the supplier where it is said, or
   * a count with its reason. Written once in the name of whoever is signed
   * in; nothing overwrites the stock, it is the sum of its bookings.
   */
  @Post(':id/movements')
  @RequiresPermission('store.write')
  book(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly levelMilli: number; readonly words: string }> {
    const values = fieldsOf(
      body,
      ['articleId', 'kind', 'quantityMilli', 'supplierId', 'reason'],
      ['reason', 'supplierId'],
    )

    if (values.kind !== 'receipt' && values.kind !== 'count') {
      throw new BadRequestException('Im Büro gebucht wird ein Eingang oder eine Zählung.')
    }

    refuse(stockMovementProblems({ quantityMilli: undefined, ...values }))

    return this.database.forTenant(identity, async (tx) => {
      const store = await heldStore(tx, id)
      const article = await heldArticle(tx, String(values.articleId ?? ''))
      const supplier =
        values.supplierId === null || values.supplierId === undefined
          ? null
          : await heldSupplier(tx, String(values.supplierId))

      await keepLine(tx, identity.tenantId, store.id, article.id)
      await tx.insert(stockMovements).values({
        tenantId: identity.tenantId,
        storeId: store.id,
        articleId: article.id,
        kind: values.kind as NewStockMovement['kind'],
        quantityMilli: values.quantityMilli as number,
        supplierId: supplier?.id ?? null,
        reason: (values.reason ?? null) as string | null,
        bookedBy: identity.userId,
      })

      const line = (await stockOf(tx, store)).lines.find((each) => each.articleId === article.id)
      const levelMilli = line?.levelMilli ?? 0

      return {
        levelMilli,
        words: `${quantityWords(levelMilli)} ${stockUnitLabel[article.unit as StockUnit]}`,
      }
    })
  }
}
