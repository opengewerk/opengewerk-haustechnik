import { labelBatchMost, type LabelFormat, labelPrintProblem } from '@opengewerk/haustechnik-domain'
import {
  Button,
  ButtonLink,
  Dialog,
  DialogActions,
  Field,
  SelectField,
} from '@opengewerk/platform-web'
import {
  type CardLabel,
  LabelCard,
  type LabelCardWords,
  NoteBox,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { maybeText, text, useSync, useSyncStatus } from '@opengewerk/platform-web/sync'
import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  blockLabel,
  type LabelBatch,
  type LabelHolder,
  labelPdfAddress,
  makeLabel,
  printLabels,
  useLabelsOf,
} from '../app/labels.js'

/**
 * The labels in the office (#98, board "Etikett: Karte und Druck"): the card
 * of the label at an asset and at a room, and the dialog that prints many
 * labels at once.
 *
 * The card is the foundation's (`LabelCard`, ADR 0010 of the repository
 * opengewerk); here is what a label hangs on in this application, who makes
 * and blocks one, and the routes that do it. Making and blocking is taking a
 * record into the register ("aufnehmen", section 7 of the concept): whoever
 * records assets does it at an asset, whoever records rooms at a room.
 */

const none =
  'Noch kein Etikett. Ein Etikett an der Anlage oder an der Tür des Raums öffnet diese Seite, wenn es jemand mit der App oder der Kamera des Telefons scannt.'

const blocking = (code: string) =>
  `Das Etikett ${code} öffnet danach nichts mehr, auch kein Exemplar, das schon klebt. Sperren lässt sich nicht zurücknehmen; ein neues Etikett legen Sie danach an.`

/** What this application says on the card of a label, at an asset and at a room. */
export const labelCardWords: Readonly<Record<LabelHolder, LabelCardWords>> = {
  assets: { title: 'Etikett', none, blocking },
  rooms: { title: 'Etikett des Raums', none, blocking },
}

const recording = { assets: 'asset.record', rooms: 'room.record' } as const

/** "Etikett", the card of the label of one asset or one room. */
export function LabelCardOf({ holder, id }: { readonly holder: LabelHolder; readonly id: string }) {
  const client = useSync()
  const { online } = useSyncStatus()
  const records = useRight(recording[holder])
  const { valid, lastBlocked } = useLabelsOf(holder, id)
  const blockedAt = maybeText(lastBlocked, 'blockedAt')

  return (
    <LabelCard
      words={labelCardWords[holder]}
      valid={
        valid
          ? {
              id: String(valid['id']),
              code: text(valid, 'code'),
              createdAt: maybeText(valid, 'createdAt'),
            }
          : null
      }
      lastBlocked={lastBlocked && blockedAt ? { code: text(lastBlocked, 'code'), blockedAt } : null}
      online={online}
      mayMake={records}
      mayBlock={records}
      onMake={async () => {
        await makeLabel(holder, id)
        await client.synchronise()
      }}
      onBlock={async (label: CardLabel) => {
        await blockLabel(holder, id, label.id)
        await client.synchronise()
      }}
      pdfAddress={(label, format, count, start) =>
        labelPdfAddress(holder, id, label.id, format, count, start)
      }
    />
  )
}

/** One thing a page offers to print labels for: the assets it lists, the rooms of its building. */
export interface PrintOffer {
  readonly key: string
  /** What stands in the choice: "Die 12 gelisteten Anlagen". */
  readonly label: string
  readonly batch: LabelBatch
  /** How many labels that is, where the page knows; a print beyond the most is refused before it is asked. */
  readonly count?: number
}

const formats: readonly { readonly value: LabelFormat; readonly label: string }[] = [
  { value: 'sheet', label: 'Bogen A4, 70 × 37 mm, 24 je Bogen' },
  { value: 'roll', label: 'Etikettendrucker, 62 × 29 mm' },
]

const blankKey = 'blank'

export const printLabelWords = {
  title: 'Etiketten drucken',
  sub: 'Je Anlage oder Raum ein Etikett. Wo es noch keines gibt, wird eines angelegt; ein gültiges wird noch einmal gedruckt.',
  blank: 'Bogen ohne Anlage, für die Bestandsaufnahme',
  whatBlankIs:
    'Etiketten, die noch an nichts hängen. Vor Ort werden sie geklebt und ihrer Anlage zugeordnet. Jeder Druck legt neue an.',
  startNote: 'Für einen angefangenen Bogen: 1 ist oben links, gezählt wird Zeile für Zeile.',
  noConnection: 'Etiketten legt der Server an und druckt sie, dafür braucht es Verbindung.',
  ready: 'Das PDF ist bereit. Etiketten, die es noch nicht gab, sind angelegt.',
  tooMany: (count: number) =>
    `Das sind ${String(count)} Etiketten. Gedruckt werden höchstens ${String(labelBatchMost)} auf einmal, grenzen Sie die Liste vorher ein.`,
} as const

/** A whole number from a field, or NaN for anything else, which the check refuses. */
function whole(value: string): number {
  return /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

/**
 * "Etiketten drucken", the dialog behind the button of the register of
 * assets and of the page of a building: what is printed, on what, and for a
 * sheet from which field. The server makes the labels that are missing and
 * answers with the PDF; it is offered as a link once it is there, because a
 * window a page opens by itself after waiting is one a browser may refuse.
 */
export function PrintLabelsDialog({
  offers,
  properties,
  propertyId,
  onClose,
}: {
  readonly offers: readonly PrintOffer[]
  /** The properties a sheet without an asset may be printed for. */
  readonly properties: readonly { readonly id: string; readonly name: string }[]
  /** The property the page stands in, chosen from the start. */
  readonly propertyId?: string | undefined
  readonly onClose: () => void
}) {
  const client = useSync()
  const { online } = useSyncStatus()
  const [chosen, setChosen] = useState<string>(offers[0]?.key ?? blankKey)
  const [format, setFormat] = useState<LabelFormat>('sheet')
  const [start, setStart] = useState('1')
  const [count, setCount] = useState('24')
  const [property, setProperty] = useState(propertyId ?? properties[0]?.id ?? '')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [href, setHref] = useState<string | null>(null)

  // The page lives as long as the dialog shows its link.
  useEffect(
    () => () => {
      if (href !== null) {
        URL.revokeObjectURL(href)
      }
    },
    [href],
  )

  const offer = offers.find((each) => each.key === chosen)
  const blank = offer === undefined
  const labels = blank ? whole(count) : (offer.count ?? 1)
  const problem =
    !blank && offer.count !== undefined && offer.count > labelBatchMost
      ? printLabelWords.tooMany(offer.count)
      : blank && property === ''
        ? 'Die Liegenschaft fehlt.'
        : labelPrintProblem(format, labels, format === 'sheet' ? whole(start) : 1, labelBatchMost)

  const changed = () => {
    setHref(null)
    setTrouble(null)
  }

  async function print() {
    setWorking(true)
    setTrouble(null)

    try {
      const batch: LabelBatch = blank
        ? { what: 'blank', propertyId: property, count: whole(count) }
        : offer.batch
      const page = await printLabels(batch, format, whole(start))

      setHref(URL.createObjectURL(page))
      // The labels that were made reach the cards of their assets and rooms.
      await client.synchronise().catch(() => undefined)
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : 'Der Druck ist nicht gelungen.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title={printLabelWords.title} width={600} onClose={onClose} sub={printLabelWords.sub}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()

          if (problem === null && online) {
            void print()
          }
        }}
      >
        <SelectField
          label="Gedruckt wird"
          options={[
            ...offers.map((each) => ({ value: each.key, label: each.label })),
            { value: blankKey, label: printLabelWords.blank },
          ]}
          value={chosen}
          onChange={(value) => {
            setChosen(value)
            changed()
          }}
        />
        {blank ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <SelectField
                label="Liegenschaft"
                options={properties.map((each) => ({ value: each.id, label: each.name }))}
                value={property}
                onChange={(value) => {
                  setProperty(value)
                  changed()
                }}
              />
              <Field
                label="Anzahl"
                inputMode="numeric"
                value={count}
                onChange={(event) => {
                  setCount(event.target.value)
                  changed()
                }}
              />
            </div>
            <NoteBox>{printLabelWords.whatBlankIs}</NoteBox>
          </>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <SelectField
            label="Format"
            options={formats}
            value={format}
            onChange={(value) => {
              setFormat(value as LabelFormat)
              changed()
            }}
          />
          {format === 'sheet' ? (
            <Field
              label="Beginnen bei"
              inputMode="numeric"
              value={start}
              onChange={(event) => {
                setStart(event.target.value)
                changed()
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
        {online ? null : (
          <p role="status" className="text-[13px] leading-[1.45] text-ink-muted">
            {printLabelWords.noConnection}
          </p>
        )}
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
              disabled={working || problem !== null || !online}
            >
              {working ? 'Einen Moment' : 'PDF erzeugen'}
            </Button>
          ) : (
            <ButtonLink
              tone="primary"
              icon={Printer}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              PDF öffnen
            </ButtonLink>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * "Etiketten drucken" in the head of a page, with its dialog: offered to
 * whoever takes assets into the register, since a print makes the labels
 * that are missing.
 */
export function PrintLabelsButton(props: {
  readonly offers: readonly PrintOffer[]
  readonly properties: readonly { readonly id: string; readonly name: string }[]
  readonly propertyId?: string | undefined
}) {
  const records = useRight('asset.record')
  const [open, setOpen] = useState(false)

  if (!records) {
    return null
  }

  return (
    <>
      <Button
        icon={Printer}
        onClick={() => {
          setOpen(true)
        }}
      >
        Etiketten drucken
      </Button>
      {open ? (
        <PrintLabelsDialog
          {...props}
          onClose={() => {
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
