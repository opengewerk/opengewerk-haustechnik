import {
  type Article,
  articlePriceProblem,
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
import { Check } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { askAt, makeAt } from '../sync/made-at.js'
import { articleListQuery, storeKey, supplierListQuery } from './store-addresses.js'

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
  quantityProblem: 'Die Menge ist eine Zahl ab null, mit höchstens drei Stellen nach dem Komma.',
  priceProblem: 'Der Preis ist ein Betrag in Euro, etwa 23,80.',
  eanHint: 'Ohne EAN bekommt das Lagerfach ein eigenes Etikett.',
  customerNumberHint: 'Ihre Nummer beim Lieferanten.',
  whereHint: 'Freier Text: wo das Lager steht.',
  storeHasNoArea:
    'Ein Lager gehört dem Betreiber, ohne Bereich. Fahrzeuge als Lager kommen mit Phase 3.',
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
}: {
  readonly working: boolean
  readonly onClose: () => void
  readonly label: string
}) {
  return (
    <DialogActions>
      <Button type="button" disabled={working} onClick={onClose}>
        Abbrechen
      </Button>
      <Button type="submit" tone="primary" icon={Check} disabled={working}>
        {working ? 'Einen Moment' : label}
      </Button>
    </DialogActions>
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
 * a note such as the delivery note; or a count, the stock found, with its
 * reason. Both say what they do to the stock before they are booked.
 */
export function BookingDialog({
  kind,
  storeId,
  storeName,
  lines,
  article: given,
  onClose,
}: {
  readonly kind: 'receipt' | 'count'
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
    booked === null || milli === null ? null : kind === 'receipt' ? booked + milli : milli
  const by = booked === null || milli === null ? null : milli - booked

  return (
    <Dialog
      title={kind === 'receipt' ? 'Wareneingang' : 'Zählung'}
      sub={storeName}
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
        ) : (
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
        )}
        <Trouble>{trouble}</Trouble>
        <Actions
          working={working}
          onClose={onClose}
          label={kind === 'receipt' ? 'Eingang buchen' : 'Zählung buchen'}
        />
      </form>
    </Dialog>
  )
}

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
        />
      </form>
    </Dialog>
  )
}
