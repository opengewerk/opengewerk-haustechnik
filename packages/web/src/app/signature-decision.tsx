import {
  activityKindLabel,
  type ActivityKind,
  type RecordState,
  type SyncConflict,
} from '@opengewerk/haustechnik-domain'
import { Button, useEntry } from '@opengewerk/platform-web'
import { DecisionFrame, maybeText, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

/**
 * A signature the server did not take (#108, ADR 0004, point 11, board
 * "Unterschrift nicht angenommen"): the activity was closed in the office or
 * is gone while the device was away, or its page is another one now than
 * the one that was signed. Neither is a field to pick a version of, as the
 * card of the foundation offers, so this one says what happened and what
 * comes next: the first is taken note of, the second is signed again.
 */

export const signatureDecisionWords = {
  kind: 'Vorgang',
  title: 'Unterschrift',
  closed:
    'Das Büro hat diesen Vorgang geschlossen, bevor das Gerät übertragen hat. Die Unterschrift wurde nicht angenommen.',
  gone: 'Diesen Vorgang gibt es nicht mehr. Die Unterschrift wurde nicht angenommen.',
  changed:
    'Die Seite hat sich geändert, seit sie unterschrieben wurde. Sie wird neu gezeigt und neu unterschrieben.',
  twice: 'Dieser Vorgang war schon unterschrieben. Diese Unterschrift wurde nicht angenommen.',
  reason: (words: string) => `Grund im Büro: ${words}`,
  noted: 'Zur Kenntnis genommen',
  again: 'Neu unterschreiben',
  drop: 'Verwerfen',
  notDecided: 'Die Entscheidung ließ sich nicht übertragen. Ohne Verbindung geht das nicht.',
} as const

/** Whether a conflict is about a signature, which this card decides. */
export function isSignatureConflict(conflict: SyncConflict): boolean {
  return conflict.entity === 'activity_signatures'
}

/** What happened to a signature, by the answer of the server. */
function whatHappened(conflict: SyncConflict): 'closed' | 'gone' | 'changed' | 'twice' {
  if (conflict.reason === 'record_missing') {
    return 'gone'
  }

  if (conflict.reason === 'changed_elsewhere') {
    return conflict.fields.includes('pageFingerprint') ? 'changed' : 'twice'
  }

  return 'closed'
}

export function SignatureDecision({ conflict }: { readonly conflict: SyncConflict }) {
  const client = useSync()
  const navigate = useNavigate()
  const wide = useEntry() === 'site'
  const activityId = maybeText(conflict.wanted as RecordState, 'activityId')
  const activity = useRecords('activities').find((each) => each['id'] === activityId)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const happened = whatHappened(conflict)
  const closingReason = maybeText(activity ?? null, 'closingReason')

  async function decide(then?: () => Promise<void>) {
    setWorking(true)
    setTrouble(null)

    try {
      await client.resolveConflict(conflict.id)
      await then?.()
    } catch {
      setTrouble(signatureDecisionWords.notDecided)
    } finally {
      setWorking(false)
    }
  }

  return (
    <DecisionFrame
      kind={
        activity === undefined
          ? signatureDecisionWords.kind
          : activityKindLabel[activity['kind'] as ActivityKind]
      }
      title={maybeText(activity ?? null, 'title') ?? signatureDecisionWords.title}
      reason={signatureDecisionWords[happened]}
    >
      {happened === 'closed' && closingReason !== null ? (
        <p className="text-[16px] leading-[1.4]">{signatureDecisionWords.reason(closingReason)}</p>
      ) : null}

      {trouble ? (
        <p role="alert" className="font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className={wide ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        {happened === 'changed' && activityId !== null ? (
          <>
            <Button
              tone="dark"
              wide={wide}
              height={56}
              disabled={working}
              onClick={() => {
                void decide(() => navigate({ to: `/vorgaenge/${activityId}/ergebnis` }))
              }}
            >
              {signatureDecisionWords.again}
            </Button>
            <Button
              wide={wide}
              height={56}
              disabled={working}
              onClick={() => {
                void decide()
              }}
            >
              {signatureDecisionWords.drop}
            </Button>
          </>
        ) : (
          <Button
            tone="dark"
            wide={wide}
            height={56}
            disabled={working}
            onClick={() => {
              void decide()
            }}
          >
            {signatureDecisionWords.noted}
          </Button>
        )}
      </div>
    </DecisionFrame>
  )
}
