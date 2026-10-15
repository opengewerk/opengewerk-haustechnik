import type { WorkOrderSettings } from '@opengewerk/haustechnik-domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { NoteBox, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useId, useState } from 'react'

import { askAt } from '../../sync/made-at.js'

export const workOrderSettingWords = {
  title: 'Aufträge',
  what: 'Was auf dem Leistungsnachweis eines Auftrags steht.',
  about:
    'Den Leistungsnachweis unterschreibt der Auftraggeber vor Ort, bevor die verantwortliche Person den Auftrag abschließt. Er nennt immer die Person, deren Gerät die Unterschrift aufgenommen hat.',
  card: 'Leistungsnachweis',
  namesAndTimes: 'Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis',
  hint: 'Eingeschaltet nennt der Leistungsnachweis zu jeder Notiz, wer sie geschrieben hat und um welche Uhrzeit, und die Uhrzeit der Unterschrift des Auftraggebers. Ausgeschaltet steht dort nur der Tag.',
  note: 'Die Dauer bleibt Aufwand des Auftrags und keine Arbeitszeiterfassung. Ist die Einstellung an, sagt es auch die Verfahrensbeschreibung. Ein Leistungsnachweis, der schon unterschrieben ist, bleibt, wie er ist.',
  save: 'Speichern',
  saved: 'Gespeichert.',
  loading: 'Wird geladen.',
  failed: 'Die Einstellung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
} as const

const settingsQuery = {
  queryKey: ['settings', 'work-orders'],
  queryFn: () => request<WorkOrderSettings>('/settings/work-orders'),
} as const

/**
 * "Einstellungen", "Aufträge", the board "Aufträge: Namen und Uhrzeiten auf
 * dem Leistungsnachweis (4.8)" (#324, section 15 of the concept): whether the
 * service report names the people who did the work and the times of their
 * notes. The default is off. Whoever may change the settings changes it here.
 */
export function WorkOrderSettingsScreen() {
  const settings = useQuery({
    ...settingsQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  return (
    <SettingsPage
      active="work-orders"
      title={workOrderSettingWords.title}
      sub={workOrderSettingWords.what}
    >
      <SettingsText>{workOrderSettingWords.about}</SettingsText>
      {settings.data === undefined ? (
        <SettingsText muted>
          {settings.isError ? workOrderSettingWords.failed : workOrderSettingWords.loading}
        </SettingsText>
      ) : (
        <NamesAndTimesForm
          key={String(settings.data.namesAndTimes)}
          held={settings.data.namesAndTimes}
        />
      )}
    </SettingsPage>
  )
}

/** The checkbox, the note under it, and the button that keeps it. */
function NamesAndTimesForm({ held }: { readonly held: boolean }) {
  const client = useSync()
  const queries = useQueryClient()
  const changes = useRight('settings.write')
  const hintId = useId()
  const [on, setOn] = useState(held)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)

  async function save() {
    setWorking(true)
    setTrouble(null)
    setSaved(false)

    try {
      const result = await askAt(client, 'PUT', '/settings/work-orders', 'work-orders', {
        namesAndTimes: on,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'work-orders'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={workOrderSettingWords.card}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="flex items-start gap-[9px] text-[14px] leading-[1.4] max-lg:min-h-tap">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-copper-solid max-lg:size-5"
            checked={on}
            disabled={!changes || working}
            aria-describedby={hintId}
            onChange={(event) => {
              setOn(event.target.checked)
              setSaved(false)
            }}
          />
          <span>
            {workOrderSettingWords.namesAndTimes}
            <span id={hintId} className="block text-[13px] text-ink-muted">
              {workOrderSettingWords.hint}
            </span>
          </span>
        </label>
        <NoteBox tone="neutral">{workOrderSettingWords.note}</NoteBox>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        {changes ? (
          <div className="flex items-center gap-2">
            <Button type="submit" tone="primary" icon={Check} disabled={working || on === held}>
              {workOrderSettingWords.save}
            </Button>
            {saved ? (
              <span className="text-[13px] text-done">{workOrderSettingWords.saved}</span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Panel>
  )
}
