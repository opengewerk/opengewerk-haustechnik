import {
  type EvidenceId,
  type RetentionProposal,
  type RetentionProposals,
  retentionLimits,
  type RetentionSettings,
  retentionSettingsProblem,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Field,
  Panel,
  TablePanel,
} from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { NoteBox, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { askAt } from '../../sync/made-at.js'

export const retentionWords = {
  title: 'Aufbewahrung',
  what: 'Wie lange die Nachweise dieses Betreibers bleiben, und was gelöscht werden kann.',
  card: 'Aufbewahrung der Nachweise',
  rule: 'Wie lange ein Nachweis bleibt, sagt das Regelpaket seiner Pflichtart: eine Zahl von Jahren, bis zur nächsten Prüfung oder solange die Anlage verwendet wird. Ein Nachweis einer eigenen Pflicht bleibt bis zur nächsten Prüfung.',
  minimum: 'Mindestens aufbewahren',
  years: 'Jahre',
  hint: 'Ab dem Tag der Durchführung. Länger als die Regel geht, kürzer nicht: es gilt das spätere Ende. Leer heißt: nur die Regel.',
  save: 'Speichern',
  saved: 'Gespeichert.',
  proposals: 'Zum Löschen vorgeschlagen',
  caption: 'Nachweise, deren Aufbewahrung abgelaufen ist, mit Pflicht, Anlage und Aufbewahrung',
  none: 'Bei keinem Nachweis ist die Aufbewahrung abgelaufen.',
  number: 'Nachweis',
  duty: 'Pflicht und Anlage',
  retention: 'Aufbewahrung',
  choice: 'Auswahl',
  of: (day: string) => `vom ${date(day)}`,
  ended: (day: string) => `endete am ${date(day)}`,
  choose: (number: string) => `${number} auswählen`,
  chooseAll: (count: number) => `Alle ${String(count)} auswählen`,
  chosen: (count: number, of: number) => `${String(count)} von ${String(of)} ausgewählt`,
  remove: 'Ausgewählte löschen',
  shell:
    'Vom Nachweis bleibt eine leere Hülle: Nummer, Pflicht, Tag und Ergebnis, und wann und auf wessen Bestätigung er gelöscht wurde. Sein Inhalt mit Unterschriften, Namen und Dateien geht, ebenso seine PDF. Was der Vorgang selbst hält und was im Änderungsprotokoll steht, bleibt.',
  run: 'Jeder Vorschlag steht auch als Frist bei der Leitung. Löschen kann nur die Leitung, und nur, was abgelaufen ist.',
  more: 'Weitere folgen, sobald diese gelöscht sind.',
  confirmTitle: (count: number) =>
    count === 1 ? '1 Nachweis löschen?' : `${String(count)} Nachweise löschen?`,
  confirmWhich: (numbers: readonly string[]) =>
    `${listed(numbers)}. Ihre Aufbewahrung ist abgelaufen. Das lässt sich nicht rückgängig machen.`,
  confirmStays:
    'Von jedem bleibt die leere Hülle mit Nummer, Pflicht, Tag und Ergebnis; die Frist der Pflicht zählt weiter wie vorher.',
  confirm: 'Endgültig löschen',
  cancel: 'Abbrechen',
  working: 'Einen Moment',
  loading: 'Wird geladen.',
  failed: 'Die Aufbewahrung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
} as const

/** Up to five numbers by name, the rest by their count. */
function listed(numbers: readonly string[]): string {
  const shown = numbers.slice(0, 5)
  const rest = numbers.length - shown.length

  if (rest > 0) {
    return `${shown.join(', ')} und ${String(rest)} weitere`
  }

  return shown.length < 2
    ? shown.join('')
    : `${shown.slice(0, -1).join(', ')} und ${String(shown.at(-1))}`
}

const settingsQuery = {
  queryKey: ['settings', 'evidence-retention'],
  queryFn: () => request<RetentionSettings>('/settings/evidence-retention'),
} as const

const proposalsQuery = {
  queryKey: ['settings', 'evidence-retention', 'proposals'],
  queryFn: () => request<RetentionProposals>('/settings/evidence-retention/proposals'),
} as const

/**
 * "Einstellungen", "Aufbewahrung", the boards "Aufbewahrung der Nachweise und
 * Vorschläge zum Löschen (2.6)" and "Nachweise löschen: Rückfrage (2.6)"
 * (#340): the longer retention of the operator, and the evidence whose
 * retention has ended, which whoever leads the operator confirms for deletion,
 * several at once.
 */
export function RetentionScreen() {
  const settings = useQuery({
    ...settingsQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  return (
    <SettingsPage active="aufbewahrung" title={retentionWords.title} sub={retentionWords.what}>
      {settings.data === undefined ? (
        <SettingsText muted>
          {settings.isError ? retentionWords.failed : retentionWords.loading}
        </SettingsText>
      ) : (
        <MinimumForm key={String(settings.data.minimumYears)} held={settings.data.minimumYears} />
      )}
      <Proposals />
      <NoteBox>{retentionWords.run}</NoteBox>
    </SettingsPage>
  )
}

/** The longer retention, in years, and the button that keeps it. */
function MinimumForm({ held }: { readonly held: number | null }) {
  const client = useSync()
  const queries = useQueryClient()
  const changes = useRight('settings.write')
  const [years, setYears] = useState(held === null ? '' : String(held))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)
  const said = years.trim() === '' ? null : Number(years)
  const problem = retentionSettingsProblem(said)

  async function save() {
    if (problem !== null) {
      setTrouble(problem)

      return
    }

    setWorking(true)
    setTrouble(null)
    setSaved(false)

    try {
      const result = await askAt(
        client,
        'PUT',
        '/settings/evidence-retention',
        'evidence-retention',
        {
          minimumYears: said,
        },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'evidence-retention'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel title={retentionWords.card}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <p className="text-[14px] leading-[1.5]">{retentionWords.rule}</p>
        <div className="w-[180px] max-sm:w-full">
          <Field
            label={retentionWords.minimum}
            inputMode="numeric"
            numeric
            unit={retentionWords.years}
            min={retentionLimits.minimumYears.min}
            max={retentionLimits.minimumYears.max}
            value={years}
            disabled={!changes || working}
            onChange={(event) => {
              setYears(event.target.value)
              setSaved(false)
              setTrouble(null)
            }}
            {...(trouble === null ? {} : { problem: trouble })}
          />
        </div>
        <p className="text-[12px] leading-[1.45] text-ink-muted">{retentionWords.hint}</p>
        {changes ? (
          <div className="flex items-center gap-3">
            <Button type="submit" tone="primary" icon={Check} disabled={working}>
              {retentionWords.save}
            </Button>
            {saved ? (
              <span role="status" className="text-[13px] text-done">
                {retentionWords.saved}
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Panel>
  )
}

/** What the run proposes, for whoever leads to choose and confirm. */
function Proposals() {
  const proposals = useQuery(proposalsQuery)
  const [chosen, setChosen] = useState<ReadonlySet<EvidenceId>>(new Set())
  const [asking, setAsking] = useState(false)

  if (proposals.data === undefined) {
    return (
      <SettingsText muted>
        {proposals.isError ? retentionWords.failed : retentionWords.loading}
      </SettingsText>
    )
  }

  const { proposals: entries, mayConfirm, more } = proposals.data
  const ids = entries.map((entry) => entry.evidenceId)
  const choose = (id: EvidenceId, on: boolean) => {
    const next = new Set(chosen)

    if (on) {
      next.add(id)
    } else {
      next.delete(id)
    }

    setChosen(next)
  }

  if (entries.length === 0) {
    return (
      <Panel title={retentionWords.proposals}>
        <p className="text-[14px] text-ink-muted">{retentionWords.none}</p>
      </Panel>
    )
  }

  const tick = (entry: RetentionProposal) => (
    <Tick
      label={retentionWords.choose(entry.number)}
      checked={chosen.has(entry.evidenceId)}
      onChange={(on) => {
        choose(entry.evidenceId, on)
      }}
    />
  )

  return (
    <>
      <TablePanel
        title={retentionWords.proposals}
        caption={retentionWords.caption}
        cards={entries.map((entry) => ({
          key: entry.evidenceId,
          title: <NumberLink entry={entry} />,
          sub: [dutyLine(entry), entry.retention, retentionWords.ended(entry.endedOn)].join(' · '),
          ...(mayConfirm ? { right: tick(entry) } : {}),
        }))}
        note={`${retentionWords.shell}${more ? ` ${retentionWords.more}` : ''}`}
        {...(mayConfirm
          ? {
              footer: (
                <div className="flex w-full flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <Tick
                      label={retentionWords.chooseAll(entries.length)}
                      checked={chosen.size === entries.length}
                      mixed={chosen.size > 0 && chosen.size < entries.length}
                      onChange={(on) => {
                        setChosen(new Set(on ? ids : []))
                      }}
                    />
                    <span>{retentionWords.chosen(chosen.size, entries.length)}</span>
                  </label>
                  <div className="grow" />
                  <Button
                    tone="danger"
                    icon={Trash2}
                    disabled={chosen.size === 0}
                    onClick={() => {
                      setAsking(true)
                    }}
                  >
                    {retentionWords.remove}
                  </Button>
                </div>
              ),
            }
          : {})}
      >
        <thead>
          <tr>
            {mayConfirm ? (
              <Column className="w-[40px]">
                <span className="sr-only">{retentionWords.choice}</span>
              </Column>
            ) : null}
            <Column className="w-[150px]">{retentionWords.number}</Column>
            <Column>{retentionWords.duty}</Column>
            <Column className="w-[250px]">{retentionWords.retention}</Column>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.evidenceId}>
              {mayConfirm ? <Cell>{tick(entry)}</Cell> : null}
              <Cell>
                <NumberLink entry={entry} />
                <div className="mt-0.5 text-[12px] text-ink-faint">
                  {retentionWords.of(entry.performedOn)}
                </div>
              </Cell>
              <Cell>
                {entry.dutyTitle}
                <div className="mt-0.5 text-[12px] text-ink-faint">{placeLine(entry)}</div>
              </Cell>
              <Cell>
                {entry.retention}
                <div className="mt-0.5 text-[12px] text-ink-faint">
                  {retentionWords.ended(entry.endedOn)}
                </div>
              </Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {asking ? (
        <ConfirmDeletion
          numbers={entries
            .filter((entry) => chosen.has(entry.evidenceId))
            .map((each) => each.number)}
          ids={[...chosen]}
          onClose={() => {
            setAsking(false)
          }}
          onDone={() => {
            setAsking(false)
            setChosen(new Set())
          }}
        />
      ) : null}
    </>
  )
}

/** The question before the deletion: how many, which, and that it cannot be undone. */
function ConfirmDeletion({
  numbers,
  ids,
  onClose,
  onDone,
}: {
  readonly numbers: readonly string[]
  readonly ids: readonly EvidenceId[]
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function confirm() {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await askAt(
        client,
        'POST',
        '/settings/evidence-retention/emptyings',
        'evidence-retention',
        { evidenceIds: [...ids] },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'evidence-retention'] })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title={retentionWords.confirmTitle(ids.length)} width={520} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <p className="text-[14px] leading-[1.5]">{retentionWords.confirmWhich(numbers)}</p>
        <p className="text-[13px] leading-[1.5] text-ink-muted">{retentionWords.confirmStays}</p>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            {retentionWords.cancel}
          </Button>
          <Button
            type="button"
            tone="danger"
            icon={Trash2}
            disabled={working}
            onClick={() => {
              void confirm()
            }}
          >
            {working ? retentionWords.working : retentionWords.confirm}
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}

function NumberLink({ entry }: { readonly entry: RetentionProposal }) {
  return (
    <Link
      to="/nachweise/$evidenceId"
      params={{ evidenceId: entry.evidenceId }}
      className="font-semibold text-ink underline decoration-1 underline-offset-2"
    >
      {entry.number}
    </Link>
  )
}

function placeLine(entry: RetentionProposal): string {
  return [
    entry.asset === null
      ? null
      : [entry.asset.number, entry.asset.name].filter((part) => part !== null).join(' '),
    entry.propertyName,
  ]
    .filter((part) => part !== null)
    .join(', ')
}

function dutyLine(entry: RetentionProposal): string {
  return `${entry.dutyTitle}, ${placeLine(entry)}`
}

/** A box to choose with, which also says "some" for the box over all. */
function Tick({
  label,
  checked,
  mixed = false,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly mixed?: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(element) => {
        if (element) {
          element.indeterminate = mixed
        }
      }}
      className="size-4 shrink-0 cursor-pointer accent-copper-solid max-lg:size-5"
      onChange={(event) => {
        onChange(event.target.checked)
      }}
    />
  )
}
