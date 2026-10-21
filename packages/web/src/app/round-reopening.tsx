import type { RecordState, RoundReopening } from '@opengewerk/haustechnik-domain'
import { Confirm } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import { maybeText, refusalFor, text, useSync } from '@opengewerk/platform-web/sync'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { askAt } from '../sync/made-at.js'

/** The words of opening a handed-in round again (#510), the same in the office and on site. */
export const reopenWords = {
  reopen: 'Wieder öffnen',
  title: 'Rundgang wieder öffnen?',
  stays:
    'Der Rundgang ist danach wieder begonnen. Seine Antworten bleiben und lassen sich ändern, bis er neu abgegeben wird.',
  goes: 'Das fällt weg',
  again:
    'Mit der nächsten Abgabe entstehen Mängel, Zählerstände und Nachweise neu. Was wegfällt, steht im Änderungsprotokoll.',
  signature: (name: string, at: string) => `die Unterschrift von ${name}, ${moment(at)}`,
  defects: (count: number) =>
    count === 1
      ? '1 Mangel, der mit ihr entstanden ist'
      : `${String(count)} Mängel, die mit ihr entstanden sind`,
  readings: (count: number) =>
    count === 1
      ? '1 Zählerstand, den sie an die Messstelle geschrieben hat'
      : `${String(count)} Zählerstände, die sie an die Messstellen geschrieben hat`,
  evidence: (numbers: readonly string[]) =>
    numbers.length === 1
      ? `1 Nachweis, der für ungültig erklärt wird: ${numbers.join(', ')}`
      : `${String(numbers.length)} Nachweise, die für ungültig erklärt werden: ${numbers.join(', ')}`,
  reopened: (at: string) =>
    `Wieder geöffnet am ${moment(at)}. Die Unterschrift davor gilt nicht mehr.`,
  failed: 'Der Rundgang ließ sich nicht wieder öffnen. Bitte erneut versuchen.',
} as const

/**
 * Whether a signature the device holds counts (#510): one still waiting in
 * the outbox, and one the server took after its activity was last opened
 * again. Before that it stands only in the change log. Which came first is
 * told by the clock of the server, as for a rejected work order.
 */
export function countsSinceReopening(
  activity: RecordState | null | undefined,
  signature: RecordState,
  pending: boolean,
): boolean {
  const reopenedAt = maybeText(activity, 'reopenedAt')

  return pending || reopenedAt === null || text(signature, 'createdAt') > reopenedAt
}

/** Each thing opening the round again takes away, a line each, as the question names them. */
export function reopeningLoss(reopening: RoundReopening): string[] {
  return [
    reopenWords.signature(reopening.signer, reopening.signedAt),
    ...(reopening.defects === 0 ? [] : [reopenWords.defects(reopening.defects)]),
    ...(reopening.readings === 0 ? [] : [reopenWords.readings(reopening.readings)]),
    ...(reopening.evidence.length === 0 ? [] : [reopenWords.evidence(reopening.evidence)]),
  ]
}

/**
 * The question before a handed-in round is opened again (#510), the boards
 * "Abgegebenen Rundgang wieder öffnen" in the office and on site: what stays,
 * what goes, and that the next handing in makes it anew. Opened with a
 * connection, at the route; the device then takes the round as begun.
 */
export function ReopenQuestion({
  roundId,
  reopening,
  onDone,
  onCancel,
}: {
  readonly roundId: string
  readonly reopening: RoundReopening
  readonly onDone: () => void
  readonly onCancel: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function reopen() {
    setTrouble(null)
    setWorking(true)

    try {
      const result = await askAt(client, 'POST', `/rounds/${roundId}/reopening`, roundId)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['rounds'] })
      onDone()
    } catch {
      setTrouble(reopenWords.failed)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Confirm
      open
      title={reopenWords.title}
      confirm={reopenWords.reopen}
      tone="primary"
      busy={working}
      onConfirm={() => {
        void reopen()
      }}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-3">
        <p>{reopenWords.stays}</p>
        <div>
          <p className="mb-1.5 text-[13px] font-semibold">{reopenWords.goes}</p>
          <ul className="list-disc pl-[18px] leading-[1.45]">
            {reopeningLoss(reopening).map((line) => (
              <li key={line} className="mb-1">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-ink-muted">{reopenWords.again}</p>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
      </div>
    </Confirm>
  )
}
