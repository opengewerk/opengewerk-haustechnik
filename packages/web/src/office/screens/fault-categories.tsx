import { type FaultCategory, faultCategoryProblems } from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, TablePanel } from '@opengewerk/platform-web'
import { SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { askAt, makeAt } from '../../sync/made-at.js'

export const faultCategoryWords = {
  title: 'Störungen',
  what: 'Die Kategorien, aus denen wählt, wer eine Störung meldet.',
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
} as const

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
    </SettingsPage>
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
