import {
  type AssignedToPerson,
  membershipEndWords,
  membershipRemovalDays,
  type MembershipSettings,
  removalDaysProblem,
} from '@opengewerk/haustechnik-domain'
import { Button, Field, Panel } from '@opengewerk/platform-web'
import { SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { askAt } from '../sync/made-at.js'

/**
 * The end of an access in "Zugänge" (sections 2.4 and 9 of the concept,
 * #356), after the boards "Zugänge mit letztem Tag und der Frist danach" and
 * "Letzter Tag eines Zugangs und was noch an der Person hängt": the period
 * after which the data of an access goes, and what still hangs on a person
 * once the dialog of their access names a last day.
 */

const settingsQuery = {
  queryKey: ['settings', 'memberships'],
  queryFn: () => request<MembershipSettings>('/settings/memberships'),
} as const

/** The period after the end of an access, for whoever looks at the accesses, and kept by whoever keeps them. */
export function MembershipEndCard() {
  const reads = useRight('membership.read')
  const settings = useQuery({ ...settingsQuery, enabled: reads })

  if (!reads) {
    return null
  }

  return (
    <Panel title={membershipEndWords.settingTitle}>
      {settings.data === undefined ? (
        <SettingsText muted>
          {settings.isError ? 'Ließ sich nicht laden.' : 'Wird geladen …'}
        </SettingsText>
      ) : (
        <RemovalForm key={String(settings.data.removalDays)} held={settings.data.removalDays} />
      )}
    </Panel>
  )
}

function RemovalForm({ held }: { readonly held: number }) {
  const client = useSync()
  const queries = useQueryClient()
  const changes = useRight('membership.write')
  const [days, setDays] = useState(String(held))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)
  const said = /^\d+$/.test(days.trim()) ? Number(days.trim()) : days

  async function save() {
    const problem = removalDaysProblem(said)

    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)
    setTrouble(null)
    setSaved(false)

    try {
      const result = await askAt(client, 'PUT', '/settings/memberships', 'memberships', {
        removalDays: said,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'memberships'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <p className="text-[14px] leading-[1.5]">{membershipEndWords.settingText}</p>
      <div className="w-[220px] max-sm:w-full">
        <Field
          label={membershipEndWords.removalDaysLabel}
          inputMode="numeric"
          numeric
          unit={membershipEndWords.removalDaysUnit}
          min={membershipRemovalDays.minimum}
          max={membershipRemovalDays.maximum}
          value={days}
          disabled={!changes || working}
          onChange={(event) => {
            setDays(event.target.value)
            setSaved(false)
            setTrouble(null)
          }}
          {...(trouble === null ? {} : { problem: trouble })}
        />
      </div>
      <p className="text-[12px] leading-[1.45] text-ink-muted">
        {membershipEndWords.removalDaysHint}
      </p>
      {changes ? (
        <div className="flex items-center gap-3">
          <Button type="submit" tone="primary" icon={Check} disabled={working}>
            Speichern
          </Button>
          {saved ? (
            <span role="status" className="text-[13px] text-done">
              {membershipEndWords.saved}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

/** One line of what hangs on a person: what it is, and what becomes of it. */
function Hanging({ what, then }: { readonly what: string; readonly then: string }) {
  return (
    <li className="flex gap-3 border-t border-line py-[7px] max-sm:flex-col max-sm:gap-0.5">
      <span className="min-w-0 flex-1 text-[14px]">{what}</span>
      <span className="w-[270px] shrink-0 text-[13px] text-ink-muted max-sm:w-auto">{then}</span>
    </li>
  )
}

/**
 * What still hangs on a person, under the last day in the dialog of their
 * access, for whoever keeps the accesses: numbers over every area and what
 * becomes of each on the day after the last day.
 */
export function HangingOnThePerson({
  userId,
  name,
}: {
  readonly userId: string
  readonly name: string
}) {
  const keeps = useRight('membership.write')
  const assigned = useQuery({
    queryKey: ['settings', 'memberships', userId, 'assigned'],
    queryFn: () =>
      request<AssignedToPerson>(`/settings/memberships/${encodeURIComponent(userId)}/assigned`),
    enabled: keeps,
  })

  if (!keeps) {
    return null
  }

  const counted = assigned.data
  const lines =
    counted === undefined
      ? []
      : [
          ...(counted.activities > 0
            ? [
                {
                  what: membershipEndWords.activities(
                    counted.activities,
                    counted.startedActivities,
                  ),
                  then: membershipEndWords.activitiesThen(counted.activities),
                },
              ]
            : []),
          ...(counted.roundPlans > 0
            ? [
                {
                  what: membershipEndWords.roundPlans(counted.roundPlans),
                  then: membershipEndWords.roundPlansThen(counted.roundPlans),
                },
              ]
            : []),
          ...(counted.tasks > 0
            ? [
                {
                  what: membershipEndWords.tasks(counted.tasks),
                  then: membershipEndWords.tasksThen(counted.tasks),
                },
              ]
            : []),
          ...(counted.duties > 0
            ? [
                {
                  what: membershipEndWords.duties(counted.duties),
                  then: membershipEndWords.dutiesThen(counted.duties),
                },
              ]
            : []),
          ...(counted.delegations > 0
            ? [
                {
                  what: membershipEndWords.delegations(counted.delegations),
                  then: membershipEndWords.delegationsThen(counted.delegations),
                },
              ]
            : []),
        ]

  return (
    <div role="group" aria-label={membershipEndWords.hangingOf(name)} className="flex flex-col">
      <span className="mb-1 text-[12px] font-semibold tracking-[0.06em] text-ink-muted uppercase">
        {membershipEndWords.hangingOf(name)}
      </span>
      {counted === undefined ? (
        <p className="text-[13px] text-ink-muted">
          {assigned.isError ? 'Ließ sich nicht laden.' : 'Wird geladen …'}
        </p>
      ) : lines.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{membershipEndWords.nothingHanging}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {lines.map((line) => (
            <Hanging key={line.what} what={line.what} then={line.then} />
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] leading-[1.45] text-ink-muted">{membershipEndWords.after}</p>
    </div>
  )
}
