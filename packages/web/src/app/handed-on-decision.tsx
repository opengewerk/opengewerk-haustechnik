import {
  activityKindLabel,
  type ActivityKind,
  type SyncConflict,
} from '@opengewerk/haustechnik-domain'
import { Button, useEntry } from '@opengewerk/platform-web'
import { DecisionFrame, maybeText, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useState } from 'react'

/**
 * A round the office gave to another person while this device was away
 * (#559): what the device still held of it, answers, a change or the
 * signature, the server did not take, and it names the person of the round
 * as the field that changed. There is nothing to choose, as the card of the
 * foundation would offer it; this one says what happened, once for the round
 * with everything that came back of it, and is taken note of.
 */

export const handedOnWords = {
  kind: 'Vorgang',
  title: 'Rundgang',
  reason:
    'Das Büro hat diesen Rundgang einer anderen Person gegeben, bevor das Gerät übertragen hat. Was hier noch nicht übertragen war, hat der Server nicht angenommen.',
  noted: 'Zur Kenntnis genommen',
  notDecided: 'Die Entscheidung ließ sich nicht übertragen. Ohne Verbindung geht das nicht.',
} as const

/** Whether the server refused a change because the round has another person now. */
export function isHandedOnConflict(conflict: SyncConflict): boolean {
  return (
    conflict.reason === 'changed_elsewhere' &&
    conflict.fields.length === 1 &&
    conflict.fields[0] === 'performerUserId'
  )
}

/** The round a conflict of that kind is about. */
export function roundOf(conflict: SyncConflict): string | null {
  return conflict.entity === 'activities'
    ? conflict.recordId
    : maybeText(conflict.wanted, 'activityId')
}

export function HandedOnDecision({ conflicts }: { readonly conflicts: readonly SyncConflict[] }) {
  const client = useSync()
  const wide = useEntry() === 'site'
  const roundId = conflicts[0] === undefined ? null : roundOf(conflicts[0])
  const round = useRecords('activities').find((each) => each['id'] === roundId)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function noted() {
    setWorking(true)
    setTrouble(null)

    try {
      for (const conflict of conflicts) {
        await client.resolveConflict(conflict.id)
      }
    } catch {
      setTrouble(handedOnWords.notDecided)
    } finally {
      setWorking(false)
    }
  }

  return (
    <DecisionFrame
      kind={
        round === undefined ? handedOnWords.kind : activityKindLabel[round['kind'] as ActivityKind]
      }
      title={maybeText(round ?? null, 'title') ?? handedOnWords.title}
      reason={handedOnWords.reason}
    >
      {trouble ? (
        <p role="alert" className="font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className={wide ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        <Button
          tone="dark"
          wide={wide}
          height={56}
          disabled={working}
          onClick={() => {
            void noted()
          }}
        >
          {handedOnWords.noted}
        </Button>
      </div>
    </DecisionFrame>
  )
}
