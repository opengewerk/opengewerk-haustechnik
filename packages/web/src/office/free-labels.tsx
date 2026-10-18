import type { BlockedPrint, FreeLabels, FreePrint } from '@opengewerk/haustechnik-domain'
import { Button, Confirm, Panel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

/** What the card says, in the words of the board "Liegenschaft mit freien Etiketten vom Bogen" (#170). */
export const freeLabelWords = {
  title: 'Freie Etiketten vom Bogen',
  printed: (day: string) => `Gedruckt am ${day}`,
  free: (count: number) => `${String(count)} frei`,
  blockAll: 'Alle sperren',
  block: 'Sperren',
  note: 'Ein freies Etikett wird vor Ort einer Anlage dieser Liegenschaft zugeordnet. Ein verlorener Bogen wird gesperrt; ein Etikett, das schon an einer Anlage hängt, bleibt.',
  askAll: (day: string) => `Alle freien Etiketten des Drucks vom ${day} sperren?`,
  whatBlocking:
    'Gesperrte Etiketten öffnen nichts mehr und lassen sich keiner Anlage mehr zuordnen. Ein Etikett dieses Drucks, das schon an einer Anlage hängt, bleibt, wie es ist.',
  confirmAll: (count: number) =>
    count === 1 ? '1 Etikett sperren' : `${String(count)} Etiketten sperren`,
  offline: 'Ohne Verbindung zum Server lässt sich kein Etikett sperren.',
} as const

function freeLabelsQuery(propertyId: string) {
  return {
    queryKey: ['free-labels', propertyId],
    queryFn: () => request<FreeLabels>(`/properties/${propertyId}/free-labels`),
  }
}

/** A code as it is printed, in groups of four. */
function grouped(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

function PrintRow({
  print,
  blocks,
  onBlockOne,
  onBlockAll,
}: {
  readonly print: FreePrint
  readonly blocks: boolean
  readonly onBlockOne: (id: string) => void
  readonly onBlockAll: (print: FreePrint) => void
}) {
  const [open, setOpen] = useState(false)
  const day = date(print.printedOn)

  return (
    <li className="border-b border-row py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="flex grow items-center gap-2 text-left"
          onClick={() => {
            setOpen((was) => !was)
          }}
        >
          {open ? (
            <ChevronDown
              size={14}
              strokeWidth={2.2}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
          ) : (
            <ChevronRight
              size={14}
              strokeWidth={2.2}
              aria-hidden="true"
              className="shrink-0 text-ink-muted"
            />
          )}
          <span className="leading-[1.3]">
            <span className="block font-medium">{freeLabelWords.printed(day)}</span>
            <span className="block text-[12px] text-ink-faint">
              {freeLabelWords.free(print.labels.length)}
            </span>
          </span>
        </button>
        {blocks && print.printId !== null ? (
          <Button
            size="small"
            onClick={() => {
              onBlockAll(print)
            }}
          >
            {freeLabelWords.blockAll}
          </Button>
        ) : null}
      </div>
      {open ? (
        <ul aria-label={freeLabelWords.printed(day)} className="mt-1.5 ml-[22px]">
          {print.labels.map((label) => (
            <li key={label.id} className="flex items-center gap-2 border-b border-row py-1">
              <span className="grow font-condensed text-[13px] font-semibold tracking-[1px]">
                {grouped(label.code)}
              </span>
              {blocks ? (
                <Button
                  size="small"
                  aria-label={`${grouped(label.code)} sperren`}
                  onClick={() => {
                    onBlockOne(label.id)
                  }}
                >
                  {freeLabelWords.block}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * The labels of the sheets printed for a property that hang on nothing yet
 * (#170, 2.8 of the concept), counted and listed one print at a time, so
 * that a lost sheet does not stand as free labels nobody sees. Whoever takes
 * assets into the register blocks one of them, or all of a print at once
 * after a question. Nothing stands here while there are none.
 */
export function FreeLabelsCard({ propertyId }: { readonly propertyId: string }) {
  const reads = useRight('asset.read')
  const blocks = useRight('asset.record')
  const queries = useQueryClient()
  const free = useQuery({ ...freeLabelsQuery(propertyId), enabled: reads })
  const [asking, setAsking] = useState<FreePrint | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const prints = free.data?.prints ?? []

  if (!reads || prints.length === 0) {
    return null
  }

  const total = prints.reduce((sum, print) => sum + print.labels.length, 0)

  async function blocked(path: string) {
    setBusy(true)
    setTrouble(null)

    try {
      await request<BlockedPrint>(path, { method: 'POST', body: JSON.stringify({}) })
      await queries.invalidateQueries({ queryKey: ['free-labels', propertyId] })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : freeLabelWords.offline)
    } finally {
      setBusy(false)
      setAsking(null)
    }
  }

  return (
    <Panel
      title={freeLabelWords.title}
      action={<span className="text-[13px] text-ink-muted">{total}</span>}
    >
      <ul aria-label={freeLabelWords.title} className="flex flex-col">
        {prints.map((print) => (
          <PrintRow
            key={print.printId ?? `${print.printedOn}:${print.labels[0]?.id ?? ''}`}
            print={print}
            blocks={blocks}
            onBlockOne={(id) => {
              void blocked(`/properties/${propertyId}/free-labels/${id}/block`)
            }}
            onBlockAll={setAsking}
          />
        ))}
      </ul>
      {trouble ? (
        <p role="alert" className="mt-2 text-[13px] text-conflict">
          {trouble}
        </p>
      ) : null}
      <p className="mt-2 text-[12px] leading-[1.4] text-ink-muted">{freeLabelWords.note}</p>
      <Confirm
        open={asking !== null}
        title={asking ? freeLabelWords.askAll(date(asking.printedOn)) : ''}
        confirm={freeLabelWords.confirmAll(asking?.labels.length ?? 0)}
        busy={busy}
        onCancel={() => {
          setAsking(null)
        }}
        onConfirm={() => {
          if (asking?.printId) {
            void blocked(`/properties/${propertyId}/free-labels/prints/${asking.printId}/block`)
          }
        }}
      >
        {freeLabelWords.whatBlocking}
      </Confirm>
    </Panel>
  )
}
