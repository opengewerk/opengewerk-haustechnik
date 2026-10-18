import {
  type Article,
  type StockLine,
  stockLimits,
  stockMovementKindLabel,
  type StockMovementLine,
  type StockSupplier,
  stockUnitLabel,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Field, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { amount, date, euros, parseQuantity } from '@opengewerk/platform-web/format'
import {
  Empty,
  FactList,
  PageHead,
  RecordColumns,
  Screen,
  useTableExport,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowRight, Check, List, Minus, Plus, Printer, Trash2 } from 'lucide-react'
import { type ReactNode, useDeferredValue, useState } from 'react'

import { askAt } from '../../sync/made-at.js'
import { RegisterFilter } from '../register-filter.js'
import { workOrderPlaces } from '../work-order-addresses.js'
import {
  articleListQuery,
  stockAddressOf,
  stockQuery,
  storeArticleQuery,
  storeKey,
  storeListQuery,
  storePlaces,
  supplierListQuery,
} from '../store-addresses.js'
import {
  ArticleDialog,
  BookingDialog,
  MoveDialog,
  quantityOf,
  RemoveDialog,
  ShelfLabelsDialog,
  StoreDialog,
  storeDialogWords,
  SupplierDialog,
} from '../store-dialogs.js'

/**
 * The stores of the operator in the office (#325, 4.12 of the concept), as
 * the boards "Lager", "Artikel" and "Lieferanten" draw them: the stock of a
 * store with its minimums and the list to order from, the articles with
 * their barcode, unit and price, the suppliers, and one article in one store
 * with every booking. Tenant-wide and without an area (2.8). Every role looks
 * at them; whoever keeps the stores books and changes ("Lager führen").
 */

export const storeWords = {
  sub: 'Artikel, Lieferanten und der Bestand je Lager. Betreiberweit, ohne Bereich.',
  loading: 'Wird geladen.',
  failed: 'Das Lager ließ sich nicht laden. Es kommt vom Server, mit Verbindung.',
  noConnection: 'Ohne Verbindung. Das Lager kommt vom Server.',
  noStore: 'Noch gibt es kein Lager.',
  noStoreKeeper: 'Ein Lager legt an, wer das Lager führt.',
  emptyStore:
    'In diesem Lager liegt noch nichts. Ein Wareneingang bringt den ersten Artikel hinein.',
  noneBelow: 'Kein Artikel liegt unter seinem Mindestbestand.',
  stockNote:
    'Ein Bestand ändert sich nur durch eine Buchung: Wareneingang, Zählung, Ausbuchung oder Entnahme am Auftrag.',
  below: 'unter Mindestbestand',
  negative: 'negativ, bitte zählen',
  removed: 'entfällt',
  noMinimum: 'keiner',
  onlyBelow: (count: number) => `Nur unter Mindestbestand (${String(count)})`,
  noArticle: 'Noch gibt es keinen Artikel.',
  noArticleFound: 'Kein Artikel passt zur Suche.',
  ownLabel: 'eigenes Etikett',
  noPrice: 'keiner',
  articleNote:
    'Preise sind eine Angabe für die Kostensicht, kein Belegwesen. Ein Artikel, der entfällt, wird markiert und bleibt an jeder Buchung lesbar.',
  searchLabel: 'Suche',
  searchPlaceholder: 'Nummer, Bezeichnung oder EAN',
  noSupplier: 'Noch gibt es keinen Lieferanten.',
  bookingsNote:
    'Buchungen werden nicht geändert und nicht gelöscht. Wer gebucht hat, steht im Änderungsprotokoll.',
  noBooking: 'Für diesen Artikel gibt es in diesem Lager noch keine Buchung.',
  minimumHint:
    'Darunter steht der Artikel in der Bestellliste dieses Lagers. Eine Benachrichtigung gibt es dafür nicht.',
  minimumProblem: 'Der Mindestbestand ist eine Zahl ab null, oder leer für keinen.',
  binHint:
    'Wo der Artikel in diesem Lager liegt: Regal, Schrank, Fach. Ein anderes Lager führt seinen eigenen.',
  saveBin: 'Lagerplatz speichern',
  saved: 'Gespeichert.',
  priceNote: 'Angabe für die Kostensicht',
  atAnOrder: 'Entnahme an einem Auftrag außerhalb Ihrer Bereiche',
} as const

const tabs = [
  { to: storePlaces.stock, label: 'Bestand' },
  { to: storePlaces.articles, label: 'Artikel' },
  { to: storePlaces.suppliers, label: 'Lieferanten' },
] as const

/** The three parts of the stores, `tabs()` of the boards, each at an address of its own. */
function StoreTabs({ active }: { readonly active: 0 | 1 | 2 }) {
  return (
    <nav aria-label="Bereiche der Seite" className="flex gap-[22px] border-b border-line">
      {tabs.map((tab, index) => (
        <Link
          key={tab.to}
          to={tab.to}
          {...(index === active ? { 'aria-current': 'page' as const } : {})}
          className={
            index === active
              ? 'border-b-2 border-copper px-0.5 py-2 text-[14px] font-semibold text-ink no-underline'
              : 'border-b-2 border-transparent px-0.5 py-2 text-[14px] text-ink-muted no-underline'
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

function Loading({ failed, paused }: { readonly failed: boolean; readonly paused: boolean }) {
  return (
    <Panel>
      <Empty>
        {failed ? storeWords.failed : paused ? storeWords.noConnection : storeWords.loading}
      </Empty>
    </Panel>
  )
}

const refusedOnce = (count: number, error: Error) => !(error instanceof RequestRefused) && count < 2

/** The stock of a line, in the colour of a conflict while it is below its minimum. */
function Level({ line }: { readonly line: StockLine }) {
  return (
    <span
      className={
        line.below || line.levelMilli < 0 ? 'font-semibold text-conflict' : 'font-semibold'
      }
    >
      {amount(line.levelMilli)}
    </span>
  )
}

function LineMark({ line }: { readonly line: StockLine }) {
  // Two devices without a network took more than lay there (#326).
  return line.levelMilli < 0 ? (
    <Status tone="conflict">{storeWords.negative}</Status>
  ) : line.below ? (
    <Status tone="conflict">{storeWords.below}</Status>
  ) : line.removed ? (
    <Status tone="locked">{storeWords.removed}</Status>
  ) : null
}

/**
 * "Lager", `bestand()` of the boards: the stock of one store, every article
 * with its stock and minimum. Below the minimum it says so, and the filter
 * narrows to those, the list to order from, which "Als Tabelle" hands out.
 */
export function StoreStockScreen() {
  const address = stockAddressOf(useSearch({ strict: false }))
  const navigate = useNavigate()
  const keeps = useRight('store.write')
  const [open, setOpen] = useState<
    'receipt' | 'count' | 'write_off' | 'store' | 'labels' | 'remove' | null
  >(null)
  const stores = useQuery({ ...storeListQuery, retry: refusedOnce })
  const chosen =
    stores.data?.find((store) => store.id === address.lager) ?? stores.data?.[0] ?? null
  const onlyBelow = address.unter === '1'
  const stock = useQuery({
    ...stockQuery(chosen?.id ?? '', onlyBelow),
    enabled: chosen !== null,
    placeholderData: keepPreviousData,
    retry: refusedOnce,
  })
  const table = useTableExport(
    `/stores/${encodeURIComponent(chosen?.id ?? '')}/stock/table${onlyBelow ? '?below=1' : ''}`,
  )
  const lines = stock.data?.lines ?? []

  const go = (next: { readonly lager?: string; readonly unter?: '1' }) => {
    void navigate({ to: storePlaces.stock, search: next, replace: true })
  }

  return (
    <Screen>
      <PageHead
        title="Lager"
        sub={storeWords.sub}
        actions={
          keeps ? (
            <>
              {chosen === null ? null : (
                <Button
                  icon={Trash2}
                  onClick={() => {
                    setOpen('remove')
                  }}
                >
                  Lager entfernen
                </Button>
              )}
              {chosen === null ? null : (
                <Button
                  icon={Printer}
                  onClick={() => {
                    setOpen('labels')
                  }}
                >
                  Etiketten drucken
                </Button>
              )}
              <Button
                icon={Plus}
                onClick={() => {
                  setOpen('store')
                }}
              >
                Lager anlegen
              </Button>
            </>
          ) : null
        }
      />
      <StoreTabs active={0} />
      {stores.data === undefined ? (
        <Loading failed={stores.isError} paused={stores.fetchStatus === 'paused'} />
      ) : chosen === null ? (
        <Panel>
          <Empty>
            {keeps ? storeWords.noStore : `${storeWords.noStore} ${storeWords.noStoreKeeper}`}
          </Empty>
        </Panel>
      ) : (
        <>
          {table.trouble}
          <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
            <RegisterFilter
              label="Lager"
              className="lg:w-[260px]"
              value={chosen.id}
              onChange={(value) => {
                go({ lager: value, ...(onlyBelow ? { unter: '1' as const } : {}) })
              }}
            >
              {stores.data.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </RegisterFilter>
            <label className="inline-flex min-h-8 items-center gap-[7px] text-[14px] text-ink max-lg:min-h-10">
              <input
                type="checkbox"
                checked={onlyBelow}
                onChange={(event) => {
                  go({ lager: chosen.id, ...(event.target.checked ? { unter: '1' as const } : {}) })
                }}
                className="size-[15px] accent-copper"
              />
              {storeWords.onlyBelow(chosen.belowCount)}
            </label>
            <span className="grow max-lg:hidden" />
            <div className="flex flex-wrap items-end gap-2.5">
              {table.button}
              {keeps ? (
                <>
                  <Button
                    icon={Minus}
                    onClick={() => {
                      setOpen('write_off')
                    }}
                  >
                    Ausbuchung
                  </Button>
                  <Button
                    icon={List}
                    onClick={() => {
                      setOpen('count')
                    }}
                  >
                    Zählung
                  </Button>
                  <Button
                    tone="primary"
                    icon={Plus}
                    onClick={() => {
                      setOpen('receipt')
                    }}
                  >
                    Wareneingang
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          {stock.data === undefined ? (
            <Loading failed={stock.isError} paused={stock.fetchStatus === 'paused'} />
          ) : lines.length === 0 ? (
            <Panel>
              <Empty>{onlyBelow ? storeWords.noneBelow : storeWords.emptyStore}</Empty>
            </Panel>
          ) : (
            <TablePanel
              caption={`Bestand im Lager ${chosen.name} mit Nummer, Artikel, Lagerplatz, Einheit, Bestand und Mindestbestand`}
              note={storeWords.stockNote}
              cards={lines.map((line) => ({
                key: line.articleId,
                title: (
                  <Link
                    to={storePlaces.article(chosen.id, line.articleId)}
                    className="text-inherit no-underline after:absolute after:inset-0"
                  >
                    {line.designation}
                  </Link>
                ),
                sub: [
                  line.number,
                  line.bin,
                  `${amount(line.levelMilli)} ${stockUnitLabel[line.unit]}`,
                  line.minimumMilli === null ? null : `Mindestbestand ${amount(line.minimumMilli)}`,
                ]
                  .filter((part) => part !== null)
                  .join(' · '),
                right: <LineMark line={line} />,
              }))}
            >
              <thead>
                <tr>
                  <Column className="w-[100px] min-w-[84px]">Nr.</Column>
                  <Column className="min-w-[200px]">Artikel</Column>
                  <Column className="w-[150px] min-w-[120px]">Lagerplatz</Column>
                  <Column className="w-[80px] min-w-[70px]">Einheit</Column>
                  <Column className="w-[90px] min-w-[80px] text-right">Bestand</Column>
                  <Column className="w-[130px] min-w-[120px] text-right">Mindestbestand</Column>
                  <Column className="w-[190px] min-w-[170px]">
                    <span className="sr-only">Hinweis</span>
                  </Column>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.articleId}>
                    <Cell className="text-ink-muted">{line.number}</Cell>
                    <Cell>
                      <Link to={storePlaces.article(chosen.id, line.articleId)}>
                        {line.designation}
                      </Link>
                    </Cell>
                    <Cell>{line.bin}</Cell>
                    <Cell>{stockUnitLabel[line.unit]}</Cell>
                    <Cell className="text-right tabular-nums">
                      <Level line={line} />
                    </Cell>
                    <Cell className="text-right tabular-nums">
                      {line.minimumMilli === null ? (
                        <span className="text-ink-faint">{storeWords.noMinimum}</span>
                      ) : (
                        amount(line.minimumMilli)
                      )}
                    </Cell>
                    <Cell>
                      <LineMark line={line} />
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )}
        </>
      )}
      {open === 'store' ? (
        <StoreDialog
          onClose={() => {
            setOpen(null)
          }}
          onMade={(id) => {
            go({ lager: id })
          }}
        />
      ) : null}
      {open === 'remove' && chosen !== null ? (
        <RemoveDialog
          name={chosen.name}
          sentence={storeDialogWords.storeGone}
          path={`/stores/${encodeURIComponent(chosen.id)}`}
          id={chosen.id}
          onClose={() => {
            setOpen(null)
          }}
          onRemoved={() => {
            setOpen(null)
            go({})
          }}
        />
      ) : null}
      {open === 'labels' && chosen !== null ? (
        <ShelfLabelsDialog
          storeId={chosen.id}
          lines={lines}
          onClose={() => {
            setOpen(null)
          }}
        />
      ) : null}
      {(open === 'receipt' || open === 'count' || open === 'write_off') && chosen !== null ? (
        <BookingDialog
          kind={open}
          storeId={chosen.id}
          storeName={chosen.name}
          lines={lines}
          onClose={() => {
            setOpen(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** The name in a row that opens its dialog for whoever keeps the stores, and plain text for anybody else. */
function OpensDialog({
  keeps,
  onOpen,
  children,
}: {
  readonly keeps: boolean
  readonly onOpen: () => void
  readonly children: ReactNode
}) {
  return keeps ? (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer text-left text-link underline underline-offset-2"
    >
      {children}
    </button>
  ) : (
    <span>{children}</span>
  )
}

/**
 * "Artikel", `artikel()` of the boards: number, name, the barcode of the
 * manufacturer where there is one, unit and price. Whoever keeps the stores
 * opens one to change it.
 */
export function ArticleListScreen() {
  const keeps = useRight('store.write')
  const [search, setSearch] = useState('')
  const wanted = useDeferredValue(search.trim())
  const [open, setOpen] = useState<Article | 'new' | null>(null)
  const articles = useQuery({
    ...articleListQuery(wanted),
    placeholderData: keepPreviousData,
    retry: refusedOnce,
  })
  const table = useTableExport('/articles/table')
  const rows = articles.data ?? []

  return (
    <Screen>
      <PageHead title="Lager" sub={storeWords.sub} />
      <StoreTabs active={1} />
      {table.trouble}
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
        <div className="w-[320px] max-lg:w-full">
          <Field
            label={storeWords.searchLabel}
            type="search"
            value={search}
            placeholder={storeWords.searchPlaceholder}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <span className="grow max-lg:hidden" />
        <div className="flex flex-wrap items-end gap-2.5">
          {table.button}
          {keeps ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                setOpen('new')
              }}
            >
              Artikel anlegen
            </Button>
          ) : null}
        </div>
      </div>
      {articles.data === undefined ? (
        <Loading failed={articles.isError} paused={articles.fetchStatus === 'paused'} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>{wanted === '' ? storeWords.noArticle : storeWords.noArticleFound}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Artikel mit Nummer, Bezeichnung, EAN, Einheit und Preis"
          note={storeWords.articleNote}
          cards={rows.map((article) => ({
            key: article.id,
            title: (
              <OpensDialog
                keeps={keeps}
                onOpen={() => {
                  setOpen(article)
                }}
              >
                {article.designation}
              </OpensDialog>
            ),
            sub: [article.number, article.ean, stockUnitLabel[article.unit]]
              .filter((part) => part !== null)
              .join(' · '),
            right: article.priceCents === null ? null : euros(article.priceCents),
          }))}
        >
          <thead>
            <tr>
              <Column className="w-[100px] min-w-[84px]">Nr.</Column>
              <Column className="min-w-[200px]">Bezeichnung</Column>
              <Column className="w-[160px] min-w-[150px]">EAN</Column>
              <Column className="w-[90px] min-w-[80px]">Einheit</Column>
              <Column className="w-[110px] min-w-[100px] text-right">Preis</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((article) => (
              <tr key={article.id}>
                <Cell className="text-ink-muted">{article.number}</Cell>
                <Cell>
                  <OpensDialog
                    keeps={keeps}
                    onOpen={() => {
                      setOpen(article)
                    }}
                  >
                    {article.designation}
                  </OpensDialog>
                </Cell>
                <Cell className="tabular-nums">
                  {article.ean ?? <span className="text-ink-faint">{storeWords.ownLabel}</span>}
                </Cell>
                <Cell>{stockUnitLabel[article.unit]}</Cell>
                <Cell className="text-right tabular-nums">
                  {article.priceCents === null ? (
                    <span className="text-ink-faint">{storeWords.noPrice}</span>
                  ) : (
                    euros(article.priceCents)
                  )}
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {open === null ? null : (
        <ArticleDialog
          key={open === 'new' ? 'new' : open.id}
          {...(open === 'new' ? {} : { article: open })}
          onClose={() => {
            setOpen(null)
          }}
        />
      )}
    </Screen>
  )
}

/** "Lieferanten", `lieferanten()` of the boards. */
export function SupplierListScreen() {
  const keeps = useRight('store.write')
  const [open, setOpen] = useState<StockSupplier | 'new' | null>(null)
  const suppliers = useQuery({ ...supplierListQuery, retry: refusedOnce })
  const rows = suppliers.data ?? []

  return (
    <Screen>
      <PageHead title="Lager" sub={storeWords.sub} />
      <StoreTabs active={2} />
      {keeps ? (
        <div className="flex justify-end">
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              setOpen('new')
            }}
          >
            Lieferant anlegen
          </Button>
        </div>
      ) : null}
      {suppliers.data === undefined ? (
        <Loading failed={suppliers.isError} paused={suppliers.fetchStatus === 'paused'} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>{storeWords.noSupplier}</Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Lieferanten mit Name, Kundennummer, E-Mail und Telefon"
          cards={rows.map((supplier) => ({
            key: supplier.id,
            title: (
              <OpensDialog
                keeps={keeps}
                onOpen={() => {
                  setOpen(supplier)
                }}
              >
                {supplier.name}
              </OpensDialog>
            ),
            sub: [supplier.customerNumber, supplier.email, supplier.phone]
              .filter((part) => part !== null && part !== '')
              .join(' · '),
          }))}
        >
          <thead>
            <tr>
              <Column className="min-w-[200px]">Name</Column>
              <Column className="w-[150px] min-w-[130px]">Kundennummer</Column>
              <Column className="w-[280px] min-w-[200px]">E-Mail</Column>
              <Column className="w-[150px] min-w-[130px]">Telefon</Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((supplier) => (
              <tr key={supplier.id}>
                <Cell>
                  <OpensDialog
                    keeps={keeps}
                    onOpen={() => {
                      setOpen(supplier)
                    }}
                  >
                    {supplier.name}
                  </OpensDialog>
                </Cell>
                <Cell>{supplier.customerNumber ?? ''}</Cell>
                <Cell>{supplier.email ?? ''}</Cell>
                <Cell>{supplier.phone ?? ''}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {open === null ? null : (
        <SupplierDialog
          key={open === 'new' ? 'new' : open.id}
          {...(open === 'new' ? {} : { supplier: open })}
          onClose={() => {
            setOpen(null)
          }}
        />
      )}
    </Screen>
  )
}

/** By how much a booking changed the stock: what came in, what was taken, or what a count corrected. */
function changeOf(movement: StockMovementLine, before: number): string {
  const by = movement.levelAfterMilli - before

  return by > 0 ? `+${amount(by)}` : by < 0 ? `−${amount(-by)}` : '±0'
}

/**
 * Where a booking came from, what it was for, or why: the supplier and the
 * note of a receipt, the reason of a count or a write-off, the other store of a transfer
 * (#391), and the work order a withdrawal was taken for (#326), with a link
 * where the person sees the order.
 */
function MovementWhy({ movement }: { readonly movement: StockMovementLine }) {
  const order = movement.workOrder
  const other = movement.counterpartStore

  if (other !== null) {
    return (
      <>
        {[`${movement.kind === 'transfer_out' ? 'nach' : 'aus'} ${other.name}`, movement.reason]
          .filter((part) => part !== null)
          .join(', ')}
      </>
    )
  }

  if (order === null) {
    return <>{[movement.supplier, movement.reason].filter((part) => part !== null).join(', ')}</>
  }

  return order.id === null || order.title === null ? (
    <span className="text-ink-muted">{storeWords.atAnOrder}</span>
  ) : (
    <Link to={workOrderPlaces.order(order.id)}>
      {[order.number, order.title].filter(Boolean).join(' ')}
    </Link>
  )
}

const kindTone = {
  receipt: 'done',
  count: 'waiting',
  withdrawal: 'neutral',
  transfer_out: 'neutral',
  transfer_in: 'neutral',
  write_off: 'neutral',
} as const

/**
 * One article in one store, `lager_artikel()` of the boards: its stock, the
 * minimum the store keeps, and every booking, the newest first, with what it
 * changed and the stock after it. Who booked stands in the change log.
 */
export function StoreArticleScreen() {
  const { storeId, articleId } = useParams({ strict: false }) as {
    readonly storeId: string
    readonly articleId: string
  }
  const keeps = useRight('store.write')
  const navigate = useNavigate()
  const [open, setOpen] = useState<'receipt' | 'count' | 'write_off' | 'move' | null>(null)
  const page = useQuery({ ...storeArticleQuery(storeId, articleId), retry: refusedOnce })

  if (page.data === undefined) {
    return (
      <Screen>
        <PageHead title="Lager" crumbs={[{ to: storePlaces.stock, label: 'Lager' }]} />
        <Loading failed={page.isError} paused={page.fetchStatus === 'paused'} />
      </Screen>
    )
  }

  const { article, store, movements } = page.data
  const unit = stockUnitLabel[article.unit]

  return (
    <Screen>
      <PageHead
        title={article.designation}
        crumbs={[
          { to: storePlaces.stock, label: 'Lager' },
          { to: `${storePlaces.stock}?lager=${store.id}`, label: store.name },
        ]}
        {...(page.data.below
          ? { badges: <Status tone="conflict">{storeWords.below}</Status> }
          : article.deletedAt === null
            ? {}
            : { badges: <Status tone="locked">{storeWords.removed}</Status> })}
        sub={`${article.number} · ${store.name}`}
        actions={
          keeps && article.deletedAt === null ? (
            <>
              {page.data.carried ? (
                <Button
                  icon={ArrowRight}
                  onClick={() => {
                    setOpen('move')
                  }}
                >
                  In anderes Lager
                </Button>
              ) : null}
              <Button
                icon={Minus}
                onClick={() => {
                  setOpen('write_off')
                }}
              >
                Ausbuchung
              </Button>
              <Button
                icon={List}
                onClick={() => {
                  setOpen('count')
                }}
              >
                Zählung
              </Button>
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  setOpen('receipt')
                }}
              >
                Wareneingang
              </Button>
            </>
          ) : null
        }
      />
      <RecordColumns
        sideWidth={340}
        main={
          movements.length === 0 ? (
            <Panel title="Buchungen">
              <Empty>{storeWords.noBooking}</Empty>
            </Panel>
          ) : (
            <TablePanel
              title="Buchungen"
              caption="Buchungen mit Tag, Art, Menge, Bestand danach und Anlass"
              note={storeWords.bookingsNote}
              cards={movements.map((movement, index) => ({
                key: movement.id,
                title: `${date(movement.bookedOn)} · ${stockMovementKindLabel[movement.kind]}`,
                sub: <MovementWhy movement={movement} />,
                right: `${changeOf(movement, movements[index + 1]?.levelAfterMilli ?? 0)} → ${amount(movement.levelAfterMilli)}`,
              }))}
            >
              <thead>
                <tr>
                  <Column className="w-[96px] min-w-[88px]">Tag</Column>
                  <Column className="w-[112px] min-w-[104px]">Art</Column>
                  <Column className="w-[64px] min-w-[56px] text-right">Menge</Column>
                  <Column className="w-[84px] min-w-[76px] text-right">Bestand danach</Column>
                  <Column className="min-w-[150px]">Woher, wozu, warum</Column>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement, index) => (
                  <tr key={movement.id}>
                    <Cell>{date(movement.bookedOn)}</Cell>
                    <Cell>
                      <Status
                        tone={kindTone[movement.kind]}
                        {...(movement.kind === 'count'
                          ? { icon: List }
                          : movement.kind === 'receipt'
                            ? { icon: Plus }
                            : movement.kind === 'write_off'
                              ? { icon: Minus }
                              : {})}
                      >
                        {stockMovementKindLabel[movement.kind]}
                      </Status>
                    </Cell>
                    <Cell className="text-right font-semibold tabular-nums">
                      {changeOf(movement, movements[index + 1]?.levelAfterMilli ?? 0)}
                    </Cell>
                    <Cell className="text-right tabular-nums">
                      {amount(movement.levelAfterMilli)}
                    </Cell>
                    <Cell>
                      <MovementWhy movement={movement} />
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )
        }
        side={
          <Panel title="In diesem Lager">
            <div className="flex flex-col gap-3">
              <FactList
                keyWidth={110}
                facts={[
                  {
                    label: 'Bestand',
                    value: <b>{quantityOf(page.data.levelMilli, article.unit)}</b>,
                  },
                  { label: 'Einheit', value: unit },
                  ...(article.ean === null ? [] : [{ label: 'EAN', value: article.ean }]),
                  ...(article.priceCents === null
                    ? []
                    : [
                        {
                          label: 'Preis',
                          value: `${euros(article.priceCents)} je ${unit}, ${storeWords.priceNote}`,
                        },
                      ]),
                ]}
              />
              <BinForm
                key={page.data.bin ?? ''}
                storeId={store.id}
                articleId={article.id}
                bin={page.data.bin}
                keeps={keeps}
              />
              <MinimumForm
                key={String(page.data.minimumMilli)}
                storeId={store.id}
                articleId={article.id}
                minimumMilli={page.data.minimumMilli}
                unit={unit}
                keeps={keeps}
              />
            </div>
          </Panel>
        }
      />
      {open === 'move' ? (
        <MoveDialog
          storeId={store.id}
          storeName={store.name}
          article={article}
          levelMilli={page.data.levelMilli}
          onClose={() => {
            setOpen(null)
          }}
          onMoved={(target) => {
            setOpen(null)
            void navigate({ to: storePlaces.article(target, article.id) })
          }}
        />
      ) : null}
      {open === 'receipt' || open === 'count' || open === 'write_off' ? (
        <BookingDialog
          kind={open}
          storeId={store.id}
          storeName={store.name}
          lines={[
            {
              articleId: article.id,
              number: article.number,
              designation: article.designation,
              unit: article.unit,
              bin: page.data.bin,
              levelMilli: page.data.levelMilli,
              minimumMilli: page.data.minimumMilli,
              below: page.data.below,
              removed: false,
            },
          ]}
          article={article}
          onClose={() => {
            setOpen(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

/**
 * Where a store keeps an article (#385): a field and the button that keeps
 * it; empty for nothing said. It holds for this store only.
 */
function BinForm({
  storeId,
  articleId,
  bin,
  keeps,
}: {
  readonly storeId: string
  readonly articleId: string
  readonly bin: string | null
  readonly keeps: boolean
}) {
  const client = useSync()
  const queries = useQueryClient()
  const held = bin ?? ''
  const [value, setValue] = useState(held)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)

  async function save() {
    setSaved(false)
    setTrouble(null)
    setWorking(true)

    try {
      const result = await askAt(
        client,
        'PUT',
        `/stores/${encodeURIComponent(storeId)}/articles/${encodeURIComponent(articleId)}/bin`,
        articleId,
        { bin: value.trim() === '' ? null : value.trim() },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: storeKey })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex items-end gap-2.5">
        <div className="w-[180px]">
          <Field
            label="Lagerplatz"
            value={value}
            maxLength={stockLimits.bin}
            disabled={!keeps || working}
            {...(trouble === null ? {} : { problem: trouble })}
            onChange={(event) => {
              setValue(event.target.value)
              setSaved(false)
            }}
          />
        </div>
        {keeps ? (
          <Button
            type="submit"
            icon={Check}
            aria-label={storeWords.saveBin}
            disabled={working || value.trim() === held}
          >
            Speichern
          </Button>
        ) : null}
      </div>
      <p className="text-[12px] text-ink-muted">{storeWords.binHint}</p>
      {saved ? (
        <p role="status" className="text-[12px] text-ink-muted">
          {storeWords.saved}
        </p>
      ) : null}
    </form>
  )
}

/** The minimum a store keeps of an article: a field and the button that keeps it; empty for none. */
function MinimumForm({
  storeId,
  articleId,
  minimumMilli,
  unit,
  keeps,
}: {
  readonly storeId: string
  readonly articleId: string
  readonly minimumMilli: number | null
  readonly unit: string
  readonly keeps: boolean
}) {
  const client = useSync()
  const queries = useQueryClient()
  const held = minimumMilli === null ? '' : amount(minimumMilli)
  const [value, setValue] = useState(held)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)

  async function save() {
    const said = value.trim() === '' ? null : parseQuantity(value.trim())

    setSaved(false)

    if ((value.trim() !== '' && said === null) || (said !== null && said < 0)) {
      setTrouble(storeWords.minimumProblem)

      return
    }

    setTrouble(null)
    setWorking(true)

    try {
      const result = await askAt(
        client,
        'PUT',
        `/stores/${encodeURIComponent(storeId)}/articles/${encodeURIComponent(articleId)}/minimum`,
        articleId,
        { minimumMilli: said },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: storeKey })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex items-end gap-2.5">
        <div className="w-[180px]">
          <Field
            label="Mindestbestand"
            numeric
            inputMode="decimal"
            unit={unit}
            value={value}
            disabled={!keeps || working}
            {...(trouble === null ? {} : { problem: trouble })}
            onChange={(event) => {
              setValue(event.target.value)
              setSaved(false)
            }}
          />
        </div>
        {keeps ? (
          <Button type="submit" icon={Check} disabled={working || value.trim() === held}>
            Speichern
          </Button>
        ) : null}
      </div>
      <p className="text-[12px] text-ink-muted">{storeWords.minimumHint}</p>
      {saved ? (
        <p role="status" className="text-[12px] text-ink-muted">
          {storeWords.saved}
        </p>
      ) : null}
    </form>
  )
}
