import { closureProblems, type RecordState } from '@opengewerk/haustechnik-domain'
import { Button, Confirm, Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { useRight } from '@opengewerk/platform-web/session'
import {
  asTextOrNull,
  type EditResult,
  type FormField,
  maybeText,
  RecordForm,
  refusalFor,
  text,
  useRelated,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { askAt, makeAt } from '../sync/made-at.js'

/**
 * The times a building is closed (4.1 and 4.5 of the concept), on its page in
 * the office, as `closures_card()` of the boards draws them: from a day to a
 * day, and what for. While a building is closed no round is made for it, and
 * the card says so.
 *
 * Kept by whoever plans and hands out activities (section 7), and with a
 * connection: a device holds the closures to read them, a new one is made at
 * the route of its building, and one is removed there (ADR 0006). None is
 * changed: one that was entered wrongly is removed and entered again, so the
 * log of the building says in two lines what stood there and what stands
 * there now.
 *
 * The card lists what is closed now and what is to come. A closure that is
 * over changes nothing any more, so it stands behind "Frühere anzeigen".
 */

export const closureWords = {
  rule: 'In einer Schließzeit entsteht kein Rundgang.',
  none: 'Für dieses Gebäude ist keine Schließzeit eingetragen.',
  noneToCome: 'Für dieses Gebäude steht keine Schließzeit an.',
  needsConnection:
    'Schließzeiten werden mit Verbindung eingetragen und entfernt. Gerade ist keine da.',
  removal: 'Danach entstehen in dieser Zeit wieder Rundgänge für dieses Gebäude.',
} as const

const fields: readonly FormField[] = [
  { name: 'startsOn', label: 'Von', kind: 'date', required: true },
  { name: 'endsOn', label: 'Bis', kind: 'date', required: true },
  {
    name: 'reason',
    label: 'Anlass',
    placeholder: 'Zum Beispiel Herbstferien',
    place: 'col-span-full',
  },
]

/** The days of a closure as a person reads them: one day, or from a day to a day. */
export function periodOf(closure: RecordState): string {
  const first = date(closure['startsOn'])
  const last = date(closure['endsOn'])

  return first === last ? first : `${first} bis ${last}`
}

/** From the earliest on; two that begin on one day by the day they end. */
function byFirstDay(left: RecordState, right: RecordState): number {
  return (
    text(left, 'startsOn').localeCompare(text(right, 'startsOn')) ||
    text(left, 'endsOn').localeCompare(text(right, 'endsOn'))
  )
}

export function BuildingClosures({ buildingId }: { readonly buildingId: string }) {
  const client = useSync()
  const status = useSyncStatus()
  const plans = useRight('activity.write')
  const closures = useRelated('building_closures', 'buildingId', buildingId)
  const [adding, setAdding] = useState(false)
  const [earlier, setEarlier] = useState(false)
  const [removing, setRemoving] = useState<{ readonly id: string; readonly period: string } | null>(
    null,
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const offline = !status.online

  const { standing, over } = useMemo(() => {
    const now = today()
    const sorted = [...closures].sort(byFirstDay)

    return {
      standing: sorted.filter((closure) => text(closure, 'endsOn') >= now),
      over: sorted.filter((closure) => text(closure, 'endsOn') < now),
    }
  }, [closures])

  const listed = earlier ? [...over, ...standing] : standing

  async function add(values: Record<string, string>): Promise<EditResult> {
    const made = await makeAt(client, `/buildings/${buildingId}/closures`, wanted(values))

    if (made.outcome === 'queued') {
      setAdding(false)
    }

    return made
  }

  async function remove(closureId: string) {
    setRemoving(null)

    const result = await askAt(
      client,
      'DELETE',
      `/buildings/${buildingId}/closures/${closureId}`,
      closureId,
    )

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  return (
    <Panel
      title="Schließzeiten"
      action={
        plans && !adding ? (
          <Button
            size="small"
            icon={Plus}
            disabled={offline}
            onClick={() => {
              setTrouble(null)
              setAdding(true)
            }}
          >
            Hinzufügen
          </Button>
        ) : null
      }
    >
      {adding ? (
        <div className="mb-3">
          <RecordForm
            fields={fields}
            columns="grid-cols-2"
            submitLabel="Hinzufügen"
            onSubmit={add}
            onCancel={() => {
              setAdding(false)
            }}
            disabled={offline}
            disabledReason={closureWords.needsConnection}
            check={(values) => Object.values(closureProblems(wanted(values)))[0] ?? null}
          />
        </div>
      ) : null}

      {plans && offline && !adding ? (
        <p role="status" className="mb-2 text-[13px] font-medium text-ink-muted">
          {closureWords.needsConnection}
        </p>
      ) : null}

      {trouble ? (
        <p role="alert" className="mb-2 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {listed.length === 0 ? (
        adding ? null : (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            {over.length === 0 ? closureWords.none : closureWords.noneToCome}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-1">
          {listed.map((closure) => {
            const closureId = String(closure['id'])
            const period = periodOf(closure)
            const reason = maybeText(closure, 'reason')

            return (
              <li key={closureId} className="flex items-center gap-2 text-[13px] leading-[1.45]">
                <div className="min-w-0 grow [overflow-wrap:anywhere]">
                  <span className="numeric font-semibold">{period}</span>
                  {reason ? <span className="text-ink-faint"> · {reason}</span> : null}
                </div>
                {plans ? (
                  <button
                    type="button"
                    aria-label={`Schließzeit ${period} entfernen`}
                    title="Entfernen"
                    disabled={offline}
                    onClick={() => {
                      setTrouble(null)
                      setRemoving({ id: closureId, period })
                    }}
                    className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted disabled:cursor-not-allowed disabled:opacity-50 max-lg:size-tap"
                  >
                    <X size={14} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-2 text-[13px] leading-[1.4] text-ink-faint">{closureWords.rule}</p>

      {over.length > 0 ? (
        <div className="mt-2">
          <Button
            size="small"
            onClick={() => {
              setEarlier((shown) => !shown)
            }}
          >
            {earlier ? 'Frühere ausblenden' : 'Frühere anzeigen'}
          </Button>
        </div>
      ) : null}

      <Confirm
        open={removing !== null}
        title={`Schließzeit ${removing?.period ?? ''} entfernen?`}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          if (removing) {
            void remove(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        {closureWords.removal}
      </Confirm>
    </Panel>
  )
}

/** What the form collected, as the route and the model take it. */
function wanted(values: Readonly<Record<string, string>>) {
  return {
    startsOn: values['startsOn'] ?? '',
    endsOn: values['endsOn'] ?? '',
    reason: asTextOrNull(values['reason']),
  }
}
