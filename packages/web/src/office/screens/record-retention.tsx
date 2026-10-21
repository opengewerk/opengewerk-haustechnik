import {
  recordRetentionFrom,
  type RecordRetentionKind,
  recordRetentionKinds,
  recordRetentionLabels,
  recordRetentionMaxYears,
  recordRetentionProblems,
  type RecordRetentionProposals,
  type RecordRetentionSettings,
  recordRetentionYears,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Field,
  TablePanel,
} from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { SettingsText } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { refusalFor, request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { askAt } from '../../sync/made-at.js'
import { listed, Tick } from './retention.js'

export const recordRetentionWords = {
  kinds: 'Was an keinem Nachweis hängt',
  kindsCaption: 'Was an keinem Nachweis hängt, mit den Jahren des Gesetzes und den eigenen',
  kind: 'Art',
  law: 'Gesetzlich',
  what: 'Was geschieht',
  least: 'Mindestens',
  years: 'Jahre',
  lawYears: (years: number) => `${String(years)} ${years === 1 ? 'Jahr' : 'Jahre'}`,
  yearsOf: (kind: string) => `${kind}, Jahre`,
  happens: {
    activity: 'Wird zur leeren Hülle, auf Bestätigung',
    defect: 'Verliert Beschreibung und Fotos, auf Bestätigung',
    task: 'Geht ganz, mit dem Fristenlauf',
    reading_person: 'Der Stand bleibt, mit dem Fristenlauf',
    booking_person: 'Die Buchung bleibt, mit dem Fristenlauf',
  } satisfies Readonly<Record<RecordRetentionKind, string>>,
  empty: 'Leer heißt: die gesetzliche Zahl. Länger geht, kürzer nicht.',
  kindsNote:
    'Vorgang und Mangel schlägt der Lauf vor, und die Leitung bestätigt wie bei einem Nachweis. Aufgaben und Personen gehen ohne Rückfrage, sobald ihre Zeit um ist.',
  save: 'Speichern',
  saved: 'Gespeichert.',
  activities: 'Vorgänge ohne Nachweis, zum Löschen vorgeschlagen',
  activitiesCaption: 'Vorgänge ohne Nachweis, deren Aufbewahrung abgelaufen ist',
  activity: 'Vorgang',
  property: 'Liegenschaft',
  ended: 'Endete',
  activityShell:
    'Vom Vorgang bleiben Art, Ort, Tag und Stand. Titel, Antworten, Unterschriften, Namen, Notizen und Dokumente gehen.',
  defects: 'Mängel nach Beseitigung, zum Löschen vorgeschlagen',
  defectsCaption: 'Behobene Mängel, deren Aufbewahrung abgelaufen ist',
  defect: 'Mangel',
  remedied: 'Behoben',
  defectShell:
    'Vom Mangel bleibt seine Zeile im Anlagenbuch mit Ort, Tagen, Klasse und Stand. Beschreibung, Bemerkung und Fotos gehen.',
  retentionEnded: (day: string) => `Aufbewahrung endete am ${date(day)}`,
  choice: 'Auswahl',
  choose: (what: string) => `${what} auswählen`,
  chooseAll: (what: 'activity' | 'defect') =>
    what === 'activity' ? 'Alle Vorgänge auswählen' : 'Alle Mängel auswählen',
  chosen: (count: number, of: number) => `${String(count)} von ${String(of)} ausgewählt`,
  remove: 'Ausgewählte löschen',
  more: 'Weitere folgen, sobald diese gelöscht sind.',
  confirmTitle: (what: 'activity' | 'defect', count: number) =>
    what === 'activity'
      ? count === 1
        ? '1 Vorgang löschen?'
        : `${String(count)} Vorgänge löschen?`
      : count === 1
        ? 'Inhalt von 1 Mangel löschen?'
        : `Inhalt von ${String(count)} Mängeln löschen?`,
  confirmWhich: (names: readonly string[]) =>
    `${listed(names)}. Ihre Aufbewahrung ist abgelaufen. Das lässt sich nicht rückgängig machen.`,
  confirm: 'Endgültig löschen',
  cancel: 'Abbrechen',
  working: 'Einen Moment',
  loading: 'Wird geladen.',
  failed: 'Die Aufbewahrung ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
} as const

const settingsQuery = {
  queryKey: ['settings', 'record-retention'],
  queryFn: () => request<RecordRetentionSettings>('/settings/record-retention'),
} as const

const proposalsQuery = {
  queryKey: ['settings', 'record-retention', 'proposals'],
  queryFn: () => request<RecordRetentionProposals>('/settings/record-retention/proposals'),
} as const

/**
 * The part of "Aufbewahrung" for what hangs on no evidence (#412, section
 * 2.6 of the concept), on the board "Aufbewahrung, auch was an keinem
 * Nachweis hängt, und Vorschläge zum Löschen (2.6)": the years per kind,
 * never fewer than the law, and the activities without evidence and the
 * remedied defects whose retention has ended, which whoever leads confirms.
 */
export function RecordRetention() {
  const settings = useQuery({
    ...settingsQuery,
    retry: (count, error) => !(error instanceof RequestRefused) && count < 2,
  })

  return (
    <>
      {settings.data === undefined ? (
        <SettingsText muted>
          {settings.isError ? recordRetentionWords.failed : recordRetentionWords.loading}
        </SettingsText>
      ) : (
        <YearsForm key={JSON.stringify(settings.data)} held={settings.data} />
      )}
      <RecordProposals />
    </>
  )
}

/** The years of the operator per kind, and the button that keeps them. */
function YearsForm({ held }: { readonly held: RecordRetentionSettings }) {
  const client = useSync()
  const queries = useQueryClient()
  const changes = useRight('settings.write')
  const [years, setYears] = useState<Readonly<Record<RecordRetentionKind, string>>>(
    () =>
      Object.fromEntries(
        recordRetentionKinds.map((kind) => [kind, held[kind] === null ? '' : String(held[kind])]),
      ) as Record<RecordRetentionKind, string>,
  )
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)
  const said = Object.fromEntries(
    recordRetentionKinds.map((kind) => [
      kind,
      years[kind].trim() === '' ? null : Number(years[kind]),
    ]),
  ) as Record<RecordRetentionKind, number | null>

  async function save() {
    const found = recordRetentionProblems(said)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)
    setTrouble(null)
    setSaved(false)

    try {
      const result = await askAt(
        client,
        'PUT',
        '/settings/record-retention',
        'record-retention',
        said,
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'record-retention'] })
      setSaved(true)
    } finally {
      setWorking(false)
    }
  }

  const input = (kind: RecordRetentionKind) => (
    <div className="w-[130px] max-sm:w-full">
      <Field
        label={recordRetentionWords.yearsOf(recordRetentionLabels[kind])}
        hideLabel
        inputMode="numeric"
        numeric
        unit={recordRetentionWords.years}
        min={recordRetentionYears[kind]}
        max={recordRetentionMaxYears}
        value={years[kind]}
        disabled={!changes || working}
        onChange={(event) => {
          setYears({ ...years, [kind]: event.target.value })
          setSaved(false)
          setTrouble(null)
        }}
        {...(problems[kind] === undefined ? {} : { problem: problems[kind] })}
      />
    </div>
  )

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <TablePanel
        title={recordRetentionWords.kinds}
        caption={recordRetentionWords.kindsCaption}
        cards={recordRetentionKinds.map((kind) => ({
          key: kind,
          title: recordRetentionLabels[kind],
          sub: [
            `${recordRetentionWords.lawYears(recordRetentionYears[kind])} ${recordRetentionFrom[kind]}`,
            recordRetentionWords.happens[kind],
          ].join(' · '),
          form: input(kind),
        }))}
        note={recordRetentionWords.kindsNote}
        footer={
          <div className="flex w-full flex-wrap items-center gap-3">
            <span className="text-[13px] text-ink-muted">{recordRetentionWords.empty}</span>
            <div className="grow" />
            {saved ? (
              <span role="status" className="text-[13px] text-done">
                {recordRetentionWords.saved}
              </span>
            ) : null}
            {trouble === null ? null : (
              <span role="alert" className="text-[13px] font-semibold text-conflict">
                {trouble}
              </span>
            )}
            {changes ? (
              <Button type="submit" tone="primary" icon={Check} disabled={working}>
                {recordRetentionWords.save}
              </Button>
            ) : null}
          </div>
        }
      >
        <thead>
          <tr>
            <Column>{recordRetentionWords.kind}</Column>
            <Column className="w-[190px]">{recordRetentionWords.law}</Column>
            <Column className="w-[300px]">{recordRetentionWords.what}</Column>
            <Column className="w-[150px]">{recordRetentionWords.least}</Column>
          </tr>
        </thead>
        <tbody>
          {recordRetentionKinds.map((kind) => (
            <tr key={kind}>
              <Cell className="font-semibold">{recordRetentionLabels[kind]}</Cell>
              <Cell>
                {recordRetentionWords.lawYears(recordRetentionYears[kind])}
                <div className="mt-0.5 text-[12px] text-ink-faint">{recordRetentionFrom[kind]}</div>
              </Cell>
              <Cell>{recordRetentionWords.happens[kind]}</Cell>
              <Cell>{input(kind)}</Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
    </form>
  )
}

/** The activities and defects the run proposes, for whoever leads to choose and confirm. */
function RecordProposals() {
  const proposals = useQuery(proposalsQuery)

  if (proposals.data === undefined) {
    return (
      <SettingsText muted>
        {proposals.isError ? recordRetentionWords.failed : recordRetentionWords.loading}
      </SettingsText>
    )
  }

  const { activities, defects, mayConfirm, more } = proposals.data

  return (
    <>
      {activities.length === 0 ? null : (
        <ProposedTable
          what="activity"
          mayConfirm={mayConfirm}
          more={more}
          entries={activities.map((entry) => ({
            id: entry.activityId,
            name: entry.title,
            main: entry.title,
            sub: entry.kind,
            middle: entry.place,
            day: entry.endedOn,
            ended: entry.retentionEndedOn,
          }))}
        />
      )}
      {defects.length === 0 ? null : (
        <ProposedTable
          what="defect"
          mayConfirm={mayConfirm}
          more={more}
          entries={defects.map((entry) => ({
            id: entry.defectId,
            name: entry.description,
            main: entry.description,
            sub: entry.place,
            middle: null,
            day: entry.remediedOn,
            ended: entry.retentionEndedOn,
          }))}
        />
      )}
    </>
  )
}

interface Proposed {
  readonly id: string
  readonly name: string
  readonly main: string
  readonly sub: string
  /** The property of an activity; a defect names its place under its description. */
  readonly middle: string | null
  readonly day: string
  readonly ended: string
}

/** One table of proposals, activities or defects, with its choice and the question before it goes. */
function ProposedTable({
  what,
  entries,
  mayConfirm,
  more,
}: {
  readonly what: 'activity' | 'defect'
  readonly entries: readonly Proposed[]
  readonly mayConfirm: boolean
  readonly more: boolean
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState(false)
  const words = recordRetentionWords
  const activity = what === 'activity'
  const choose = (id: string, on: boolean) => {
    const next = new Set(chosen)

    if (on) {
      next.add(id)
    } else {
      next.delete(id)
    }

    setChosen(next)
  }
  const tick = (entry: Proposed) => (
    <Tick
      label={words.choose(entry.name)}
      checked={chosen.has(entry.id)}
      onChange={(on) => {
        choose(entry.id, on)
      }}
    />
  )

  return (
    <>
      <TablePanel
        title={activity ? words.activities : words.defects}
        caption={activity ? words.activitiesCaption : words.defectsCaption}
        cards={entries.map((entry) => ({
          key: entry.id,
          title: entry.main,
          sub: [entry.sub, entry.middle, date(entry.day), words.retentionEnded(entry.ended)]
            .filter((part) => part !== null)
            .join(' · '),
          ...(mayConfirm ? { right: tick(entry) } : {}),
        }))}
        note={`${activity ? words.activityShell : words.defectShell}${more ? ` ${words.more}` : ''}`}
        {...(mayConfirm
          ? {
              footer: (
                <div className="flex w-full flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <Tick
                      label={words.chooseAll(what)}
                      checked={chosen.size === entries.length}
                      mixed={chosen.size > 0 && chosen.size < entries.length}
                      onChange={(on) => {
                        setChosen(new Set(on ? entries.map((entry) => entry.id) : []))
                      }}
                    />
                    <span>{words.chosen(chosen.size, entries.length)}</span>
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
                    {words.remove}
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
                <span className="sr-only">{words.choice}</span>
              </Column>
            ) : null}
            <Column>{activity ? words.activity : words.defect}</Column>
            {activity ? <Column className="w-[260px]">{words.property}</Column> : null}
            <Column className="w-[250px]">{activity ? words.ended : words.remedied}</Column>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              {mayConfirm ? <Cell>{tick(entry)}</Cell> : null}
              <Cell>
                <span className="font-semibold">{entry.main}</span>
                <div className="mt-0.5 text-[12px] text-ink-faint">{entry.sub}</div>
              </Cell>
              {activity ? <Cell>{entry.middle}</Cell> : null}
              <Cell>
                {date(entry.day)}
                <div className="mt-0.5 text-[12px] text-ink-faint">
                  {words.retentionEnded(entry.ended)}
                </div>
              </Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {asking ? (
        <ConfirmEmptying
          what={what}
          names={entries.filter((entry) => chosen.has(entry.id)).map((entry) => entry.name)}
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
function ConfirmEmptying({
  what,
  names,
  ids,
  onClose,
  onDone,
}: {
  readonly what: 'activity' | 'defect'
  readonly names: readonly string[]
  readonly ids: readonly string[]
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const words = recordRetentionWords

  async function confirm() {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await askAt(
        client,
        'POST',
        what === 'activity'
          ? '/settings/record-retention/activity-emptyings'
          : '/settings/record-retention/defect-emptyings',
        'record-retention',
        what === 'activity' ? { activityIds: [...ids] } : { defectIds: [...ids] },
      )

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await queries.invalidateQueries({ queryKey: ['settings', 'record-retention'] })
      onDone()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog title={words.confirmTitle(what, ids.length)} width={520} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <p className="text-[14px] leading-[1.5]">{words.confirmWhich(names)}</p>
        <p className="text-[13px] leading-[1.5] text-ink-muted">
          {what === 'activity' ? words.activityShell : words.defectShell}
        </p>
        {trouble === null ? null : (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        )}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            {words.cancel}
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
            {working ? words.working : words.confirm}
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}
