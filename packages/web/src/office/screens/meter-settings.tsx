import { meterLimits, type MeterSettings } from '@opengewerk/haustechnik-domain'
import { Button, Panel, SelectField } from '@opengewerk/platform-web'
import { SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { askAt } from '../../sync/made-at.js'

export const meterSettingWords = {
  title: 'Zähler',
  what: 'An welchem Tag im Monat der Stand jedes Zählers fällig ist.',
  own: 'Eine Messstelle kann einen eigenen Tag haben; er steht an der Messstelle unter „Bearbeiten“. Möglich ist der 1. bis 28., den jeder Monat hat.',
  card: 'Stichtag der Zähler',
  keyDay: 'Stichtag',
  day: (day: number) => `Der ${String(day)}. eines Monats`,
  hint: 'An diesem Tag ist der Stand jedes Zählers fällig. Ein Stand gilt für den Stichtag davor, wenn er höchstens 14 Tage danach abgelesen wird, sonst für den nächsten.',
  save: 'Speichern',
  saved: 'Gespeichert.',
  loading: 'Wird geladen.',
  failed: 'Der Stichtag ließ sich nicht laden. Er kommt vom Server, mit Verbindung.',
} as const

const settingsQuery = {
  queryKey: ['settings', 'meters'],
  queryFn: () => request<MeterSettings>('/settings/meters'),
} as const

/**
 * "Einstellungen", "Zähler", the board "Zähler, Stichtag (4.9)" (section 4.9 of the
 * concept, #120: "Den Stichtag stellt der Betreiber ein, eine einzelne
 * Messstelle kann davon abweichen"): the day of the month every reading is
 * due on. Whoever may change the settings changes it here.
 */
export function MeterSettingsScreen() {
  const settings = useQuery({
    ...settingsQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  return (
    <SettingsPage active="meters" title={meterSettingWords.title} sub={meterSettingWords.what}>
      <SettingsText>{meterSettingWords.own}</SettingsText>
      {settings.data === undefined ? (
        <SettingsText muted>
          {settings.isError ? meterSettingWords.failed : meterSettingWords.loading}
        </SettingsText>
      ) : (
        <KeyDayForm key={settings.data.keyDay} held={settings.data.keyDay} />
      )}
    </SettingsPage>
  )
}

/** The key day in a select, and the button that keeps it. */
function KeyDayForm({ held }: { readonly held: number }) {
  const client = useSync()
  const queries = useQueryClient()
  const changes = useRight('settings.write')
  const [day, setDay] = useState(String(held))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)

  async function save() {
    setWorking(true)
    setTrouble(null)
    setSaved(false)

    try {
      const result = await askAt(client, 'PUT', '/settings/meters', 'meters', {
        keyDay: Number(day),
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'meters'] })
      await queries.invalidateQueries({ queryKey: ['meters'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={meterSettingWords.card}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex flex-col gap-1">
          <div className="w-[260px] max-sm:w-full">
            <SelectField
              label={meterSettingWords.keyDay}
              value={day}
              disabled={!changes || working}
              options={Array.from({ length: meterLimits.keyDay }, (_, index) => ({
                value: String(index + 1),
                label: meterSettingWords.day(index + 1),
              }))}
              onChange={(value) => {
                setDay(value)
                setSaved(false)
              }}
            />
          </div>
          <p className="text-[12px] leading-[1.45] text-ink-muted">{meterSettingWords.hint}</p>
        </div>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        {changes ? (
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              tone="primary"
              icon={Check}
              disabled={working || day === String(held)}
            >
              {meterSettingWords.save}
            </Button>
            {saved ? (
              <span className="text-[13px] text-done">{meterSettingWords.saved}</span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Panel>
  )
}
