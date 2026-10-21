import {
  type Article,
  articlePriceProblem,
  labelBatchMost,
  type LabelFormat,
  labelPrintProblem,
  byNameIn,
  type StockLine,
  stockArticleProblems,
  stockLimits,
  stockMovementProblems,
  type StockSupplier,
  stockSupplierProblems,
  type StockUnit,
  stockUnitLabel,
  stockUnits,
  storeProblems,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  ButtonLink,
  Dialog,
  DialogActions,
  Field,
  SelectField,
  TextArea,
} from '@opengewerk/platform-web'
import { amount, centsAsInput, parseEuros, parseQuantity } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { type EditResult, refusalFor, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Download, Printer, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { printShelfLabels } from '../app/labels.js'
import { askAt, makeAt } from '../sync/made-at.js'
import { labelFormats, printLabelWords } from './labels.js'
import {
  articleListQuery,
  stockQuery,
  storeKey,
  storeListQuery,
  supplierListQuery,
} from './store-addresses.js'

/**
 * What the stores are kept with in the office (#325, 4.12 of the concept),
 * each in a dialog of its own as the boards draw them: a receipt and a count,
 * a new store, an article and a supplier, made and changed. All of it is
 * asked of the routes of the server, with a connection, and the stores are
 * read again once it is done. A booking is written once; what is wrong in
 * it, the next count sets right.
 */

export const storeDialogWords = {
  findHint: 'Ein Strichcode des Herstellers wählt den Artikel gleich aus.',
  findPlaceholder: 'Nummer, Bezeichnung oder EAN',
  noArticle: 'Kein Artikel passt.',
  chooseArticle: 'Artikel wählen',
  noSupplier: 'Nicht angegeben',
  receiptIsBooking: (from: string, to: string) =>
    `Der Eingang ist eine Buchung: der Bestand steigt von ${from} auf ${to}. Geändert oder gelöscht wird sie nicht; eine falsche Menge berichtigt die nächste Zählung.`,
  receiptStays:
    'Der Eingang ist eine Buchung. Geändert oder gelöscht wird sie nicht; eine falsche Menge berichtigt die nächste Zählung.',
  countedFrom: (booked: string, by: string) =>
    `Gebucht steht ${booked}. Die Zählung berichtigt um ${by}.`,
  countedHint: 'Was im Lager liegt, so wie es gezählt wurde.',
  reasonHint: 'Der Grund steht an der Buchung und bleibt lesbar.',
  writeOffHint: 'Wie viel ohne Auftrag weggenommen wurde.',
  writeOffFrom: (now: string, after: string) => `Im Lager: ${now}, danach ${after}.`,
  writeOffReasonHint:
    'Wofür der Artikel gebraucht wurde. Der Grund steht an der Buchung und bleibt lesbar.',
  writeOffNote:
    'Die Ausbuchung ist eine Buchung ohne Auftrag: der Bestand sinkt um die Menge. Geändert oder gelöscht wird sie nicht; eine falsche Menge berichtigt ein Wareneingang oder die nächste Zählung.',
  quantityProblem: 'Die Menge ist eine Zahl ab null, mit höchstens drei Stellen nach dem Komma.',
  priceProblem: 'Der Preis ist ein Betrag in Euro, etwa 23,80.',
  eanHint: 'Ohne EAN bekommt das Lagerfach ein eigenes Etikett.',
  customerNumberHint: 'Ihre Nummer beim Lieferanten.',
  whereHint: 'Freier Text: wo das Lager steht.',
  storeHasNoArea:
    'Ein Lager gehört dem Betreiber, ohne Bereich. Fahrzeuge als Lager kommen mit Phase 3.',
  shelfLabels:
    'Je Artikel ein Etikett für sein Fach in diesem Lager. Wo es noch keines gibt, wird eines angelegt; ein gültiges wird noch einmal gedruckt.',
  withoutEan: (count: number) => `Die ${String(count)} Artikel dieses Lagers ohne EAN`,
  everyArticle: (count: number) => `Alle ${String(count)} Artikel dieses Lagers`,
  noShelf: 'Für diese Auswahl gibt es kein Etikett zu drucken.',
  removeTitle: (name: string) => `${name} entfernen?`,
  storeGone:
    'Es steht danach nicht mehr zur Wahl. An Buchungen und an Entnahmen an Aufträgen bleibt es mit seinem Namen lesbar.',
  articleGone:
    'Danach steht er bei keinem Eingang und keiner Zählung mehr zur Wahl; an Buchungen und Aufträgen bleibt er lesbar. Hat er noch Bestand, bringt ihn erst eine Zählung auf null.',
  supplierGone:
    'Er steht danach bei keinem Wareneingang mehr zur Wahl. An seinen Buchungen bleibt er lesbar.',
  moveTitle: 'In ein anderes Lager umziehen',
  moveSub: (article: string, store: string) => `${article}, aus ${store}`,
  moveStock: (quantity: string, target: string) =>
    `Der Bestand von ${quantity} geht als Umbuchung mit: ein Abgang hier, ein Zugang in ${target}.`,
  moveNothing: 'Hier liegt nichts davon; gebucht wird nichts.',
  moveJoins: (there: string, after: string) =>
    `Das Lager führt den Artikel schon mit ${there}; danach sind es dort ${after}, und sein Mindestbestand und sein Lagerplatz dort bleiben.`,
  moveLeaves: 'Hier steht der Artikel danach nicht mehr.',
  moveNote: 'Steht an beiden Buchungen.',
  noOtherStore: 'Es gibt kein anderes Lager. Legen Sie zuerst eines an.',
} as const

/** Asks a route, shows what it refused with, and has the stores read again once it is done. */
function useAsking(onDone: () => void) {
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function ask(question: () => Promise<EditResult>) {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await question()

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: storeKey })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return { working, trouble, setTrouble, ask }
}

function Trouble({ children }: { readonly children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

function Actions({
  working,
  onClose,
  label,
  onRemove,
}: {
  readonly working: boolean
  readonly onClose: () => void
  readonly label: string
  /** Offers "Entfernen" on the left, for a record that is changed (#391). */
  readonly onRemove?: (() => void) | undefined
}) {
  return (
    <DialogActions>
      {onRemove === undefined ? null : (
        <Button
          type="button"
          tone="danger"
          icon={Trash2}
          disabled={working}
          className="mr-auto"
          onClick={onRemove}
        >
          Entfernen
        </Button>
      )}
      <Button type="button" disabled={working} onClick={onClose}>
        Abbrechen
      </Button>
      <Button type="submit" tone="primary" icon={Check} disabled={working}>
        {working ? 'Einen Moment' : label}
      </Button>
    </DialogActions>
  )
}

/**
 * Removing a store, an article or a supplier (#391): asked once more, and
 * marked by the server, never deleted. What the server refuses, a store that
 * carries an article or an article with stock, the dialog says instead, with
 * nothing left to press but "Schließen".
 */
export function RemoveDialog({
  name,
  sentence,
  path,
  id,
  onClose,
  onRemoved,
}: {
  readonly name: string
  readonly sentence: string
  readonly path: string
  readonly id: string
  readonly onClose: () => void
  readonly onRemoved: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onRemoved)

  return (
    <Dialog title={storeDialogWords.removeTitle(name)} width={520} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {trouble === null ? (
          <p className="text-[14px] leading-[1.5]">{sentence}</p>
        ) : (
          <p role="alert" className="text-[14px] leading-[1.5]">
            {trouble}
          </p>
        )}
        <DialogActions>
          {trouble === null ? (
            <>
              <Button type="button" disabled={working} onClick={onClose}>
                Abbrechen
              </Button>
              <Button
                type="button"
                tone="danger"
                icon={Trash2}
                disabled={working}
                onClick={() => {
                  void ask(() => askAt(client, 'DELETE', path, id))
                }}
              >
                {working ? 'Einen Moment' : 'Entfernen'}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={onClose}>
              Schließen
            </Button>
          )}
        </DialogActions>
      </div>
    </Dialog>
  )
}

/**
 * Moving an article to another store (#391), `artikel_umziehen()` of the
 * boards: its stock goes along as a transfer, and where the other store
 * carries it already the two come together and its minimum there stays.
 */
export function MoveDialog({
  storeId,
  storeName,
  article,
  levelMilli,
  onClose,
  onMoved,
}: {
  readonly storeId: string
  readonly storeName: string
  readonly article: Pick<Article, 'id' | 'designation' | 'unit'>
  readonly levelMilli: number
  readonly onClose: () => void
  readonly onMoved: (storeId: string) => void
}) {
  const client = useSync()
  const stores = useQuery(storeListQuery)
  const others = (stores.data ?? []).filter((store) => store.id !== storeId)
  const [chosen, setChosen] = useState('')
  const target = others.find((store) => store.id === chosen) ?? others[0]
  const there = useQuery({ ...stockQuery(target?.id ?? '', false), enabled: target !== undefined })
  const line = there.data?.lines.find((each) => each.articleId === article.id)
  const [reason, setReason] = useState('')
  const { working, trouble, ask } = useAsking(() => {
    if (target !== undefined) {
      onMoved(target.id)
    }
  })
  const quantity = (milli: number) => quantityOf(milli, article.unit)

  return (
    <Dialog
      title={storeDialogWords.moveTitle}
      sub={storeDialogWords.moveSub(article.designation, storeName)}
      width={600}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()

          if (target === undefined) {
            return
          }

          void ask(() =>
            askAt(
              client,
              'POST',
              `/stores/${encodeURIComponent(storeId)}/articles/${encodeURIComponent(article.id)}/move`,
              article.id,
              { toStoreId: target.id, reason: reason.trim() === '' ? null : reason.trim() },
            ),
          )
        }}
      >
        {stores.data !== undefined && target === undefined ? (
          <p className="text-[14px]">{storeDialogWords.noOtherStore}</p>
        ) : (
          <>
            <SelectField
              label="In das Lager"
              required
              starred
              value={target?.id ?? ''}
              options={others.map((store) => ({ value: store.id, label: store.name }))}
              onChange={setChosen}
            />
            {target === undefined ? null : (
              <NoteBox tone="neutral">
                {[
                  levelMilli > 0
                    ? storeDialogWords.moveStock(quantity(levelMilli), target.name)
                    : storeDialogWords.moveNothing,
                  line === undefined
                    ? null
                    : storeDialogWords.moveJoins(
                        quantity(line.levelMilli),
                        quantity(line.levelMilli + Math.max(levelMilli, 0)),
                      ),
                  storeDialogWords.moveLeaves,
                ]
                  .filter((part) => part !== null)
                  .join(' ')}
              </NoteBox>
            )}
            <Field
              label="Bemerkung"
              value={reason}
              maxLength={stockLimits.note}
              hint={storeDialogWords.moveNote}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
          </>
        )}
        <Trouble>{trouble}</Trouble>
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            tone="primary"
            icon={ArrowRight}
            disabled={working || target === undefined}
          >
            {working ? 'Einen Moment' : 'Umziehen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** A quantity with its unit, as a person reads it: "23 Stück". */
export function quantityOf(milli: number, unit: StockUnit): string {
  return `${amount(milli)} ${stockUnitLabel[unit]}`
}

/** The label of an article in a choice: its number before what it is called. */
function articleLabel(article: Pick<Article, 'number' | 'designation'>): string {
  return `${article.number} ${article.designation}`
}

/**
 * The article a booking is for: a search through number, designation and
 * EAN that narrows the choice under it, and a barcode of the manufacturer
 * typed or scanned into it chooses its article at once.
 */
function ArticleChoice({
  value,
  onChange,
  problem,
}: {
  readonly value: string
  readonly onChange: (article: Article | null) => void
  readonly problem: string | undefined
}) {
  const [search, setSearch] = useState('')
  const all = useQuery(articleListQuery(''))
  const words = search.trim().toLocaleLowerCase('de')
  const shown = useMemo(
    () =>
      (all.data ?? []).filter(
        (article) =>
          article.id === value ||
          words === '' ||
          [article.number, article.designation, article.ean ?? ''].some((text) =>
            text.toLocaleLowerCase('de').includes(words),
          ),
      ),
    [all.data, value, words],
  )

  return (
    <>
      <Field
        label="Suchen"
        type="search"
        value={search}
        placeholder={storeDialogWords.findPlaceholder}
        hint={storeDialogWords.findHint}
        onChange={(event) => {
          const typed = event.target.value
          const scanned = (all.data ?? []).find((article) => article.ean === typed.trim())

          setSearch(typed)

          if (scanned !== undefined) {
            onChange(scanned)
          }
        }}
      />
      <SelectField
        label="Artikel"
        required
        starred
        value={value}
        {...(problem === undefined ? {} : { problem })}
        options={[
          {
            value: '',
            label: shown.length === 0 ? storeDialogWords.noArticle : storeDialogWords.chooseArticle,
          },
          ...shown.map((article) => ({ value: article.id, label: articleLabel(article) })),
        ]}
        onChange={(id) => {
          onChange((all.data ?? []).find((article) => article.id === id) ?? null)
        }}
      />
    </>
  )
}

/**
 * A booking of the office in a store, as the boards "Wareneingang" and
 * "Zählung" draw it: a receipt, how much and from which supplier where it is said, with
 * a note such as the delivery note; a count, the stock found, with its
 * reason; or a write-off (#430, the board "Ausbuchung"), how much was taken
 * for something without a work order, and why. Each says what it does to
 * the stock before it is booked.
 */
export function BookingDialog({
  kind,
  storeId,
  storeName,
  lines,
  article: given,
  onClose,
}: {
  readonly kind: 'receipt' | 'count' | 'write_off'
  readonly storeId: string
  readonly storeName: string
  readonly lines: readonly StockLine[]
  readonly article?: Article
  readonly onClose: () => void
}) {
  const client = useSync()
  const suppliers = useQuery(supplierListQuery)
  const { working, trouble, ask } = useAsking(onClose)
  const [article, setArticle] = useState<Article | null>(given ?? null)
  const [quantity, setQuantity] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const milli = parseQuantity(quantity)
  const booked =
    article === null ? null : (lines.find((line) => line.articleId === article.id)?.levelMilli ?? 0)
  const unit = article?.unit ?? 'piece'

  function send() {
    const values = {
      articleId: article?.id ?? '',
      kind,
      quantityMilli: milli ?? -1,
      supplierId: kind === 'receipt' && supplierId !== '' ? supplierId : null,
      reason: reason.trim() === '' ? null : reason.trim(),
    }
    const found: Record<string, string> = { ...stockMovementProblems(values) }

    if (article === null) {
      found['articleId'] = 'Wählen Sie den Artikel.'
    }

    if (milli === null || milli < 0) {
      found['quantityMilli'] = storeDialogWords.quantityProblem
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void ask(() =>
      askAt(client, 'POST', `/stores/${encodeURIComponent(storeId)}/movements`, storeId, values),
    )
  }

  const change =
    booked === null || milli === null
      ? null
      : kind === 'receipt'
        ? booked + milli
        : kind === 'write_off'
          ? booked - milli
          : milli
  const by = booked === null || milli === null ? null : milli - booked

  return (
    <Dialog title={bookingTitle[kind]} sub={storeName} width={600} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {given === undefined ? (
          <ArticleChoice
            value={article?.id ?? ''}
            onChange={setArticle}
            problem={problems['articleId']}
          />
        ) : (
          <p className="text-[14px] font-medium text-ink">{articleLabel(given)}</p>
        )}
        {kind === 'receipt' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Menge"
                required
                starred
                numeric
                inputMode="decimal"
                unit={stockUnitLabel[unit]}
                value={quantity}
                {...(problems['quantityMilli'] === undefined
                  ? {}
                  : { problem: problems['quantityMilli'] })}
                onChange={(event) => {
                  setQuantity(event.target.value)
                }}
              />
              <SelectField
                label="Lieferant"
                value={supplierId}
                options={[
                  { value: '', label: storeDialogWords.noSupplier },
                  ...[...(suppliers.data ?? [])]
                    .sort((left, right) => byNameIn(left.name, right.name))
                    .map((supplier) => ({ value: supplier.id, label: supplier.name })),
                ]}
                onChange={setSupplierId}
              />
            </div>
            <Field
              label="Bemerkung"
              value={reason}
              maxLength={stockLimits.note}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
            <NoteBox>
              {change === null || booked === null
                ? storeDialogWords.receiptStays
                : storeDialogWords.receiptIsBooking(
                    quantityOf(booked, unit),
                    quantityOf(change, unit),
                  )}
            </NoteBox>
          </>
        ) : kind === 'count' ? (
          <>
            <div className="sm:w-[240px]">
              <Field
                label="Gezählter Bestand"
                required
                starred
                numeric
                inputMode="decimal"
                unit={stockUnitLabel[unit]}
                value={quantity}
                hint={
                  booked === null || by === null
                    ? storeDialogWords.countedHint
                    : storeDialogWords.countedFrom(
                        quantityOf(booked, unit),
                        `${by > 0 ? '+' : ''}${amount(by)}`,
                      )
                }
                {...(problems['quantityMilli'] === undefined
                  ? {}
                  : { problem: problems['quantityMilli'] })}
                onChange={(event) => {
                  setQuantity(event.target.value)
                }}
              />
            </div>
            <TextArea
              label="Grund"
              starred
              required
              rows={2}
              value={reason}
              maxLength={stockLimits.note}
              hint={storeDialogWords.reasonHint}
              {...(problems['reason'] === undefined ? {} : { problem: problems['reason'] })}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
          </>
        ) : (
          <>
            <div className="sm:w-[240px]">
              <Field
                label="Menge"
                required
                starred
                numeric
                inputMode="decimal"
                unit={stockUnitLabel[unit]}
                value={quantity}
                hint={
                  booked === null || change === null
                    ? storeDialogWords.writeOffHint
                    : storeDialogWords.writeOffFrom(
                        quantityOf(booked, unit),
                        quantityOf(change, unit),
                      )
                }
                {...(problems['quantityMilli'] === undefined
                  ? {}
                  : { problem: problems['quantityMilli'] })}
                onChange={(event) => {
                  setQuantity(event.target.value)
                }}
              />
            </div>
            <TextArea
              label="Grund"
              starred
              required
              rows={2}
              value={reason}
              maxLength={stockLimits.note}
              hint={storeDialogWords.writeOffReasonHint}
              {...(problems['reason'] === undefined ? {} : { problem: problems['reason'] })}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
            <NoteBox>{storeDialogWords.writeOffNote}</NoteBox>
          </>
        )}
        <Trouble>{trouble}</Trouble>
        <Actions working={working} onClose={onClose} label={bookingAction[kind]} />
      </form>
    </Dialog>
  )
}

const bookingTitle = { receipt: 'Wareneingang', count: 'Zählung', write_off: 'Ausbuchung' } as const

const bookingAction = {
  receipt: 'Eingang buchen',
  count: 'Zählung buchen',
  write_off: 'Ausbuchen',
} as const

/** A new store, `lager_neu()` of the boards: its name and, in words, where it is. */
export function StoreDialog({
  onClose,
  onMade,
}: {
  readonly onClose: () => void
  readonly onMade: (id: string) => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})

  return (
    <Dialog title="Lager anlegen" width={520} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()

          const values = {
            name: name.trim(),
            location: location.trim() === '' ? null : location.trim(),
          }
          const found = storeProblems(values)

          setProblems(found)

          if (Object.keys(found).length === 0) {
            void ask(async () => {
              const result = await makeAt(client, '/stores', values)

              if (result.outcome !== 'refused') {
                // The stock of the new store is what the screen shows next.
                onMade(result.id)
              }

              return result
            })
          }
        }}
      >
        <Field
          label="Name"
          required
          starred
          value={name}
          maxLength={stockLimits.storeName}
          {...(problems['name'] === undefined ? {} : { problem: problems['name'] })}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <Field
          label="Wo"
          value={location}
          maxLength={stockLimits.location}
          hint={storeDialogWords.whereHint}
          onChange={(event) => {
            setLocation(event.target.value)
          }}
        />
        <p className="text-[12px] text-ink-muted">{storeDialogWords.storeHasNoArea}</p>
        <Trouble>{trouble}</Trouble>
        <Actions working={working} onClose={onClose} label="Anlegen" />
      </form>
    </Dialog>
  )
}

/** An article made or changed, `artikel_neu()` of the boards. */
export function ArticleDialog({
  article,
  onClose,
}: {
  readonly article?: Article
  readonly onClose: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)
  const [removing, setRemoving] = useState(false)
  const [number, setNumber] = useState(article?.number ?? '')
  const [designation, setDesignation] = useState(article?.designation ?? '')
  const [ean, setEan] = useState(article?.ean ?? '')
  const [unit, setUnit] = useState<StockUnit>(article?.unit ?? 'piece')
  const [price, setPrice] = useState(
    article?.priceCents === null || article === undefined ? '' : centsAsInput(article.priceCents),
  )
  const [description, setDescription] = useState(article?.description ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})

  function send() {
    const cents = price.trim() === '' ? null : parseEuros(price)
    const values = {
      number: number.trim(),
      designation: designation.trim(),
      ean: ean.trim() === '' ? null : ean.trim(),
      unit,
      priceCents: cents,
      description: description.trim() === '' ? null : description.trim(),
    }
    const found: Record<string, string> = { ...stockArticleProblems(values) }

    if ((price.trim() !== '' && cents === null) || articlePriceProblem(cents) !== null) {
      found['priceCents'] = storeDialogWords.priceProblem
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void ask(() =>
      article === undefined
        ? makeAt(client, '/articles', values)
        : askAt(client, 'PATCH', `/articles/${encodeURIComponent(article.id)}`, article.id, values),
    )
  }

  if (removing && article !== undefined) {
    return (
      <RemoveDialog
        name={article.designation}
        sentence={storeDialogWords.articleGone}
        path={`/articles/${encodeURIComponent(article.id)}`}
        id={article.id}
        onClose={onClose}
        onRemoved={onClose}
      />
    )
  }

  return (
    <Dialog
      title={article === undefined ? 'Artikel anlegen' : `${article.designation} ändern`}
      width={640}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field
            label="Nummer"
            required
            starred
            value={number}
            maxLength={stockLimits.articleNumber}
            {...(problems['number'] === undefined ? {} : { problem: problems['number'] })}
            onChange={(event) => {
              setNumber(event.target.value)
            }}
          />
          <Field
            label="Bezeichnung"
            required
            starred
            value={designation}
            maxLength={stockLimits.designation}
            {...(problems['designation'] === undefined ? {} : { problem: problems['designation'] })}
            onChange={(event) => {
              setDesignation(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="EAN"
            value={ean}
            inputMode="numeric"
            placeholder="13 oder 8 Ziffern"
            hint={storeDialogWords.eanHint}
            {...(problems['ean'] === undefined ? {} : { problem: problems['ean'] })}
            onChange={(event) => {
              setEan(event.target.value)
            }}
          />
          <SelectField
            label="Einheit"
            required
            value={unit}
            options={stockUnits.map((each) => ({ value: each, label: stockUnitLabel[each] }))}
            onChange={(value) => {
              setUnit(value as StockUnit)
            }}
          />
          <Field
            label="Preis"
            numeric
            inputMode="decimal"
            unit="€"
            value={price}
            {...(problems['priceCents'] === undefined ? {} : { problem: problems['priceCents'] })}
            onChange={(event) => {
              setPrice(event.target.value)
            }}
          />
        </div>
        <TextArea
          label="Beschreibung"
          rows={2}
          value={description}
          maxLength={stockLimits.description}
          onChange={(event) => {
            setDescription(event.target.value)
          }}
        />
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={article === undefined ? 'Anlegen' : 'Speichern'}
          onRemove={
            article === undefined
              ? undefined
              : () => {
                  setRemoving(true)
                }
          }
        />
      </form>
    </Dialog>
  )
}

/** A supplier made or changed, `lieferant_neu()` of the boards. */
export function SupplierDialog({
  supplier,
  onClose,
}: {
  readonly supplier?: StockSupplier
  readonly onClose: () => void
}) {
  const client = useSync()
  const { working, trouble, ask } = useAsking(onClose)
  const [removing, setRemoving] = useState(false)
  const [name, setName] = useState(supplier?.name ?? '')
  const [customerNumber, setCustomerNumber] = useState(supplier?.customerNumber ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim())

  function send() {
    const values = {
      name: name.trim(),
      customerNumber: orNull(customerNumber),
      phone: orNull(phone),
      email: orNull(email),
      notes: orNull(notes),
    }
    const found = stockSupplierProblems(values)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    void ask(() =>
      supplier === undefined
        ? makeAt(client, '/suppliers', values)
        : askAt(
            client,
            'PATCH',
            `/suppliers/${encodeURIComponent(supplier.id)}`,
            supplier.id,
            values,
          ),
    )
  }

  if (removing && supplier !== undefined) {
    return (
      <RemoveDialog
        name={supplier.name}
        sentence={storeDialogWords.supplierGone}
        path={`/suppliers/${encodeURIComponent(supplier.id)}`}
        id={supplier.id}
        onClose={onClose}
        onRemoved={onClose}
      />
    )
  }

  return (
    <Dialog
      title={supplier === undefined ? 'Lieferant anlegen' : `${supplier.name} ändern`}
      width={600}
      onClose={onClose}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <Field
          label="Name"
          required
          starred
          value={name}
          maxLength={stockLimits.supplierName}
          {...(problems['name'] === undefined ? {} : { problem: problems['name'] })}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Kundennummer"
            value={customerNumber}
            maxLength={stockLimits.customerNumber}
            hint={storeDialogWords.customerNumberHint}
            {...(problems['customerNumber'] === undefined
              ? {}
              : { problem: problems['customerNumber'] })}
            onChange={(event) => {
              setCustomerNumber(event.target.value)
            }}
          />
          <Field
            label="Telefon"
            type="tel"
            value={phone}
            {...(problems['phone'] === undefined ? {} : { problem: problems['phone'] })}
            onChange={(event) => {
              setPhone(event.target.value)
            }}
          />
        </div>
        <Field
          label="E-Mail"
          type="email"
          value={email}
          {...(problems['email'] === undefined ? {} : { problem: problems['email'] })}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
        />
        <TextArea
          label="Notiz"
          rows={2}
          value={notes}
          {...(problems['notes'] === undefined ? {} : { problem: problems['notes'] })}
          onChange={(event) => {
            setNotes(event.target.value)
          }}
        />
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={supplier === undefined ? 'Anlegen' : 'Speichern'}
          onRemove={
            supplier === undefined
              ? undefined
              : () => {
                  setRemoving(true)
                }
          }
        />
      </form>
    </Dialog>
  )
}

/**
 * "Etiketten drucken" at a store (#326, the board "Etiketten für die Fächer
 * eines Lagers"): one label for the shelf of each article, the articles
 * without the barcode of their manufacturer or all of them. The server makes
 * the labels that are missing and answers with the PDF, offered as a link
 * once it is there.
 */
export function ShelfLabelsDialog({
  storeId,
  lines,
  onClose,
}: {
  readonly storeId: string
  readonly lines: readonly StockLine[]
  readonly onClose: () => void
}) {
  const client = useSync()
  const articles = useQuery(articleListQuery(''))
  const withoutEan = lines.filter(
    (line) =>
      !line.removed &&
      (articles.data ?? []).some(
        (article) => article.id === line.articleId && article.ean === null,
      ),
  ).length
  const kept = lines.filter((line) => !line.removed).length
  const [which, setWhich] = useState<'withoutEan' | 'all'>('withoutEan')
  const [format, setFormat] = useState<LabelFormat>('sheet')
  const [start, setStart] = useState('1')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [href, setHref] = useState<string | null>(null)
  const count = which === 'all' ? kept : withoutEan
  const begin = /^\d{1,3}$/.test(start.trim()) ? Number(start.trim()) : Number.NaN
  const problem =
    count === 0
      ? storeDialogWords.noShelf
      : labelPrintProblem(format, count, format === 'sheet' ? begin : 1, labelBatchMost)

  useEffect(
    () => () => {
      if (href !== null) {
        URL.revokeObjectURL(href)
      }
    },
    [href],
  )

  async function print() {
    setWorking(true)
    setTrouble(null)

    try {
      setHref(URL.createObjectURL(await printShelfLabels(storeId, which, format, begin)))
      await client.synchronise().catch(() => undefined)
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : 'Der Druck ist nicht gelungen.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Etiketten drucken"
      width={600}
      onClose={onClose}
      sub={storeDialogWords.shelfLabels}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()

          if (problem === null) {
            void print()
          }
        }}
      >
        <SelectField
          label="Gedruckt wird"
          value={which}
          options={[
            { value: 'withoutEan', label: storeDialogWords.withoutEan(withoutEan) },
            { value: 'all', label: storeDialogWords.everyArticle(kept) },
          ]}
          onChange={(value) => {
            setWhich(value as 'withoutEan' | 'all')
            setHref(null)
          }}
        />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <SelectField
            label="Format"
            options={labelFormats}
            value={format}
            onChange={(value) => {
              setFormat(value as LabelFormat)
              setHref(null)
            }}
          />
          {format === 'sheet' ? (
            <Field
              label="Beginnen bei"
              inputMode="numeric"
              value={start}
              onChange={(event) => {
                setStart(event.target.value)
                setHref(null)
              }}
            />
          ) : null}
        </div>
        {format === 'sheet' ? (
          <p className="text-[12px] leading-[1.45] text-ink-muted">{printLabelWords.startNote}</p>
        ) : null}
        {(problem ?? trouble) ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {problem ?? trouble}
          </p>
        ) : null}
        {href === null ? null : <NoteBox>{printLabelWords.ready}</NoteBox>}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            {href === null ? 'Abbrechen' : 'Schließen'}
          </Button>
          {href === null ? (
            <Button
              type="submit"
              tone="primary"
              icon={Printer}
              disabled={working || problem !== null}
            >
              {working ? 'Einen Moment' : 'PDF erzeugen'}
            </Button>
          ) : (
            <ButtonLink tone="primary" icon={Download} href={href} download="Etiketten Lager.pdf">
              PDF herunterladen
            </ButtonLink>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}
