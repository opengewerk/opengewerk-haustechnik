import {
  type DefectClassSetting,
  defectTermLimits,
  defectTermProblem,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, TablePanel } from '@opengewerk/platform-web'
import { SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { askAt } from '../../sync/made-at.js'

export const defectClassWords = {
  title: 'Mängelklassen',
  what: 'Welche Frist zur Beseitigung jede Klasse vorgibt.',
  from: 'Die Klassen kommen aus den Paketen; der Betreiber stellt nur die Vorgabe der Frist ein.',
  caption: 'Mängelklassen mit der Vorgabe der Frist und dem Paket, aus dem sie kommen',
  note: 'Die Frist eines Mangels ist die Vorgabe seiner Klasse, gezählt ab dem Tag der Feststellung. Am Mangel lässt sie sich ändern. Ohne Vorgabe setzt die Frist, wer Mängel führt.',
  unsafe: 'macht die Anlage unsicher',
  safe: 'ohne Folge für den Betrieb der Anlage',
  loading: 'Wird geladen.',
  failed: 'Die Mängelklassen ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  none: 'Kein Paket nennt Mängelklassen.',
  days: 'Tage',
  saved: 'Gespeichert.',
} as const

const settingsQuery = {
  queryKey: ['settings', 'defect-classes'],
  queryFn: () => request<readonly DefectClassSetting[]>('/settings/defect-classes'),
} as const

/**
 * "Einstellungen", "Mängelklassen", `maengelklassen()` of the boards (4.6 of
 * the concept, #116): every class the packages name, with the default the
 * operator sets for it, the days to set a defect of the class right in.
 * Whoever may change the settings changes a default here, one class at a
 * time; an empty field takes the default away.
 */
export function DefectClassSettingsScreen() {
  const settings = useQuery({
    ...settingsQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const changes = useRight('settings.write')

  return (
    <SettingsPage
      active="maengelklassen"
      title={defectClassWords.title}
      sub={defectClassWords.what}
    >
      <SettingsText>{defectClassWords.from}</SettingsText>
      {settings.data === undefined ? (
        <SettingsText muted>
          {settings.isError ? defectClassWords.failed : defectClassWords.loading}
        </SettingsText>
      ) : settings.data.length === 0 ? (
        <SettingsText muted>{defectClassWords.none}</SettingsText>
      ) : (
        <TablePanel
          title="Klassen"
          caption={defectClassWords.caption}
          note={defectClassWords.note}
          grow={false}
          cards={settings.data.map((setting) => ({
            key: setting.key,
            title: setting.label,
            sub: [
              setting.unsafe ? defectClassWords.unsafe : defectClassWords.safe,
              setting.packageTitle,
            ].join(' · '),
            right: <TermForm key={setting.key} setting={setting} changes={changes} />,
          }))}
        >
          <thead>
            <tr>
              <Column>Klasse</Column>
              <Column className="w-[220px] min-w-[200px]">Vorgabe der Frist</Column>
              <Column className="w-[160px] min-w-[120px]">Woher</Column>
            </tr>
          </thead>
          <tbody>
            {settings.data.map((setting) => (
              <tr key={setting.key}>
                <Cell>
                  <span className="block text-[14px] font-medium">{setting.label}</span>
                  <span className="block text-[12px] text-ink-faint">
                    {setting.unsafe ? defectClassWords.unsafe : defectClassWords.safe}
                  </span>
                </Cell>
                <Cell>
                  <TermForm key={setting.key} setting={setting} changes={changes} />
                </Cell>
                <Cell className="text-ink-muted">{setting.packageTitle}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </SettingsPage>
  )
}

/** The default of one class: the days in a field, and the button that keeps them. */
function TermForm({
  setting,
  changes,
}: {
  readonly setting: DefectClassSetting
  readonly changes: boolean
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [days, setDays] = useState(setting.dueDays === null ? '' : String(setting.dueDays))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)
  const held = setting.dueDays === null ? '' : String(setting.dueDays)

  async function save() {
    const said = days.trim() === '' ? null : Number(days.trim())
    const problem = said === null ? null : defectTermProblem(said)

    setTrouble(problem)
    setSaved(false)

    if (problem !== null) {
      return
    }

    setWorking(true)

    try {
      const result = await askAt(
        client,
        'PUT',
        `/settings/defect-classes/${encodeURIComponent(setting.key)}`,
        setting.key,
        { dueDays: said },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'defect-classes'] })
      await queries.invalidateQueries({ queryKey: ['defects'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={defectTermLimits.least}
          max={defectTermLimits.most}
          value={days}
          disabled={!changes || working}
          aria-label={`Vorgabe der Frist für ${setting.label} in Tagen`}
          aria-invalid={trouble === null ? undefined : true}
          onChange={(event) => {
            setDays(event.target.value)
            setSaved(false)
          }}
          className="h-[30px] w-[70px] rounded-[4px] border border-line-strong bg-surface px-2 text-[13px] text-ink tabular-nums max-lg:h-10"
        />
        <span className="text-[13px] text-ink-muted">{defectClassWords.days}</span>
        {changes ? (
          <Button size="small" type="submit" disabled={working || days.trim() === held}>
            Speichern
          </Button>
        ) : null}
      </div>
      {trouble === null ? null : (
        <p role="alert" className="text-[12px] font-semibold text-conflict">
          {trouble}
        </p>
      )}
      {saved ? (
        <p role="status" className="text-[12px] text-ink-muted">
          {defectClassWords.saved}
        </p>
      ) : null}
    </form>
  )
}
