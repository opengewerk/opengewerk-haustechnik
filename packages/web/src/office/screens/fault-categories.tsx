import {
  type FaultCategory,
  faultCategoryProblems,
  type FaultReportSettings,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, TablePanel } from '@opengewerk/platform-web'
import { NoteBox, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useId, useState } from 'react'

import { askAt, makeAt } from '../../sync/made-at.js'

export const faultCategoryWords = {
  title: 'Störungen',
  what: 'Die Kategorien, aus denen wählt, wer eine Störung meldet, und das Melden ohne Konto.',
  from: 'Beim ersten Start stehen hier sechs Vorschläge. Die Reihenfolge ist die der Auswahl beim Melden.',
  caption: 'Kategorien der Störungen mit der Zahl der Meldungen, die sie tragen',
  note: 'Eine entfernte Kategorie steht nicht mehr zur Wahl. Meldungen, die sie tragen, behalten sie.',
  name: 'Name',
  reports: 'Gemeldet',
  none: 'keine',
  count: (n: number) => (n === 1 ? '1 Meldung' : `${String(n)} Meldungen`),
  add: 'Neue Kategorie',
  addPlaceholder: 'etwa Lüftung oder Beleuchtung',
  loading: 'Wird geladen.',
  failed: 'Die Kategorien ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
  saved: 'Gespeichert.',
  outside: 'Ohne Konto melden',
  openByLabel: 'Störungen über das Etikett auch ohne Anmeldung annehmen',
  openByLabelHint:
    'Eingeschaltet öffnet das Etikett an einem Raum oder einer Anlage ohne Anmeldung eine Seite zum Melden: Kategorie, Beschreibung, Foto und auf Wunsch eine E-Mail-Adresse für die Rückmeldung. Die Seite nennt nur den Raum. Ausgeschaltet sagt das Etikett, dass es eine Anmeldung braucht.',
  openByLabelNote:
    'Die Seite steht jedem offen, der das Etikett sieht. Je Etikett und je Anschluss nimmt sie nur wenige Meldungen in der Stunde an, und ein gesperrtes Etikett öffnet nichts. Die Rückmeldung geht über den Mailserver unter „E-Mail-Einstellungen“; die Adresse wird mit der Erledigung gelöscht und steht nicht im Änderungsprotokoll.',
  save: 'Speichern',
  settingFailed: 'Die Einstellung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
} as const

const reportSettingsKey = ['settings', 'fault-reports'] as const

const categoriesKey = ['settings', 'fault-categories'] as const

/**
 * "Einstellungen", "Störungen", `kategorien()` of the boards (section 4.7 of
 * the concept, #331): the categories of the operator, which the first start
 * proposes. Whoever may change the settings renames, adds and removes them;
 * a removed one is marked and stays at the reports that carry it.
 */
export function FaultCategorySettingsScreen() {
  const categories = useQuery({
    queryKey: categoriesKey,
    queryFn: () => request<readonly FaultCategory[]>('/settings/fault-categories'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })
  const changes = useRight('settings.write')

  return (
    <SettingsPage
      active="stoerungen"
      title={faultCategoryWords.title}
      sub={faultCategoryWords.what}
    >
      <SettingsText>{faultCategoryWords.from}</SettingsText>
      {categories.data === undefined ? (
        <SettingsText muted>
          {categories.isError ? faultCategoryWords.failed : faultCategoryWords.loading}
        </SettingsText>
      ) : (
        <TablePanel
          title="Kategorien"
          caption={faultCategoryWords.caption}
          note={faultCategoryWords.note}
          grow={false}
          cards={categories.data.map((category) => ({
            key: category.id,
            title: category.name,
            sub: uses(category),
            right: <CategoryForm key={category.id} category={category} changes={changes} />,
          }))}
        >
          <thead>
            <tr>
              <Column>{faultCategoryWords.name}</Column>
              <Column className="w-[140px] min-w-[120px]">{faultCategoryWords.reports}</Column>
            </tr>
          </thead>
          <tbody>
            {categories.data.map((category) => (
              <tr key={category.id}>
                <Cell>
                  <CategoryForm key={category.id} category={category} changes={changes} />
                </Cell>
                <Cell className="text-ink-muted">{uses(category)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {changes ? <AddCategory /> : null}
      <OutsideReporting />
    </SettingsPage>
  )
}

/**
 * Whether the label takes a report from somebody without an account (#332,
 * the card "Ohne Konto melden" of the board), shipped off. Whoever may change
 * the settings switches it; whoever may only read them sees how it stands.
 */
function OutsideReporting() {
  const settings = useQuery({
    queryKey: reportSettingsKey,
    queryFn: () => request<FaultReportSettings>('/settings/fault-reports'),
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  if (settings.data === undefined) {
    return (
      <SettingsText muted>
        {settings.isError ? faultCategoryWords.settingFailed : faultCategoryWords.loading}
      </SettingsText>
    )
  }

  return (
    <OpenByLabelForm key={String(settings.data.openByLabel)} held={settings.data.openByLabel} />
  )
}

function OpenByLabelForm({ held }: { readonly held: boolean }) {
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
      const result = await askAt(client, 'PUT', '/settings/fault-reports', 'fault-reports', {
        openByLabel: on,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: reportSettingsKey })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={faultCategoryWords.outside}>
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
            {faultCategoryWords.openByLabel}
            <span id={hintId} className="block text-[13px] text-ink-muted">
              {faultCategoryWords.openByLabelHint}
            </span>
          </span>
        </label>
        <NoteBox tone="neutral">{faultCategoryWords.openByLabelNote}</NoteBox>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        {changes ? (
          <div className="flex items-center gap-2">
            <Button type="submit" tone="primary" icon={Check} disabled={working || on === held}>
              {faultCategoryWords.save}
            </Button>
            {saved ? (
              <span className="text-[13px] text-done">{faultCategoryWords.saved}</span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Panel>
  )
}

function uses(category: FaultCategory): string {
  return category.reports === undefined || category.reports === 0
    ? faultCategoryWords.none
    : faultCategoryWords.count(category.reports)
}

/** Keeps what a route answered or says why it did not. */
function useCategoryChange() {
  const client = useSync()
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function run(change: () => ReturnType<typeof askAt>): Promise<boolean> {
    setTrouble(null)
    setWorking(true)

    try {
      const result = await change()

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return false
      }

      await queries.invalidateQueries({ queryKey: categoriesKey })
      await queries.invalidateQueries({ queryKey: ['fault-reports'] })

      return true
    } finally {
      setWorking(false)
    }
  }

  return { client, trouble, setTrouble, working, run }
}

/** The name of one category in a field, with the buttons that keep it and that remove the category. */
function CategoryForm({
  category,
  changes,
}: {
  readonly category: FaultCategory
  readonly changes: boolean
}) {
  const [name, setName] = useState(category.name)
  const [saved, setSaved] = useState(false)
  const { client, trouble, setTrouble, working, run } = useCategoryChange()

  async function save() {
    const problem = faultCategoryProblems({ name })['name']

    setSaved(false)

    if (problem !== undefined) {
      setTrouble(problem)

      return
    }

    setSaved(
      await run(() =>
        askAt(client, 'PUT', `/settings/fault-categories/${category.id}`, category.id, {
          name: name.trim(),
        }),
      ),
    )
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
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={name}
          disabled={!changes || working}
          aria-label={`Name der Kategorie ${category.name}`}
          aria-invalid={trouble === null ? undefined : true}
          onChange={(event) => {
            setName(event.target.value)
            setSaved(false)
          }}
          className="h-[30px] min-w-0 flex-1 rounded-[4px] border border-line-strong bg-surface px-2 text-[13px] text-ink max-lg:h-10"
        />
        {changes ? (
          <>
            <Button size="small" type="submit" disabled={working || name.trim() === category.name}>
              Speichern
            </Button>
            <Button
              size="small"
              type="button"
              disabled={working}
              aria-label={`${category.name} entfernen`}
              onClick={() => {
                void run(() =>
                  askAt(client, 'DELETE', `/settings/fault-categories/${category.id}`, category.id),
                )
              }}
            >
              Entfernen
            </Button>
          </>
        ) : null}
      </div>
      {trouble === null ? null : (
        <p role="alert" className="text-[12px] font-semibold text-conflict">
          {trouble}
        </p>
      )}
      {saved ? (
        <p role="status" className="text-[12px] text-ink-muted">
          {faultCategoryWords.saved}
        </p>
      ) : null}
    </form>
  )
}

/** A new category at the end of the choice. */
function AddCategory() {
  const [name, setName] = useState('')
  const { client, trouble, setTrouble, working, run } = useCategoryChange()

  async function add() {
    const problem = faultCategoryProblems({ name })['name']

    if (problem !== undefined) {
      setTrouble(problem)

      return
    }

    if (await run(() => makeAt(client, '/settings/fault-categories', { name: name.trim() }))) {
      setName('')
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-2 rounded-[6px] border border-line bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      <label htmlFor="fault-category-new" className="text-[13px] font-medium text-ink">
        {faultCategoryWords.add}
      </label>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          id="fault-category-new"
          type="text"
          value={name}
          placeholder={faultCategoryWords.addPlaceholder}
          disabled={working}
          aria-invalid={trouble === null ? undefined : true}
          onChange={(event) => {
            setName(event.target.value)
          }}
          className="h-[34px] w-[320px] max-w-full rounded-[4px] border border-line-strong bg-surface px-2.5 text-[14px] text-ink max-lg:h-10"
        />
        <Button tone="primary" type="submit" disabled={working || name.trim() === ''}>
          Hinzufügen
        </Button>
      </div>
      {trouble === null ? null : (
        <p role="alert" className="text-[12px] font-semibold text-conflict">
          {trouble}
        </p>
      )}
    </form>
  )
}
