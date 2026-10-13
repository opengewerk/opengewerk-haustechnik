import {
  counted,
  countersignatureWords,
  type ImportNote,
  type ImportProblem,
  type MeterImportCounts,
  meterImportEntryLabel,
  meterImportFields,
  type MeterImportRow,
  meterImportSummary,
  meterImportTotal,
  type TableField,
  type TemplateImportCounts,
  templateImportFields,
  type TemplateImportRow,
  templateImportSummary,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, type Crumb, TablePanel } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import {
  ColumnsPanel,
  Empty,
  NoteBox,
  PageHead,
  Screen,
  sendTable,
  Steps,
  TableFilePanel,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { useSync } from '@opengewerk/platform-web/sync'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, ChevronRight, Upload } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { CountTiles, type Tile } from '../count-tiles.js'
import { importRoutes } from '../import-addresses.js'
import { meterListPlace, meterPlaces } from '../meter-addresses.js'
import { roundsPlace, templateListPlace } from '../round-template-addresses.js'
import {
  linesWords,
  NotesPanel,
  ProblemsPanel,
  refusalOf,
  StepActions,
  TemplateButton,
  useTable,
} from './imports.js'

/**
 * The imports that bring nothing but their table (#130, second part, section
 * 11 of the concept): the history of the meters of a predecessor application
 * under "Zähler", and the templates of its rounds under "Vorlagen".
 *
 * Both go the way of every import: a file is chosen and read by the server,
 * its columns are given to fields, the server says what the lines would make
 * and writes nothing while it does, and one press takes all of it over or
 * none of it. What differs between the two is said once each, below; the way
 * is written once.
 */

interface Preview<Counts, Row> {
  readonly lines: number
  readonly counts: Counts
  readonly problems: readonly ImportProblem[]
  readonly moreProblems: number
  readonly notes: readonly ImportNote[]
  readonly moreNotes: number
  /** What is taken over and asked about once more; only the import of the meters has it. */
  readonly jumps?: readonly ImportNote[]
  readonly moreJumps?: number
  readonly rows: readonly Row[]
  readonly moreRows: number
}

const steps = ['Datei und Spalten', 'Vorschau'] as const

/** Four figures over a preview: two beside each other on a phone, all four from 1024 pixels. */
const fourTiles = 'grid-cols-2 lg:grid-cols-4'

/** How many lines the preview shows before somebody asks for all of them. */
const shownAtFirst = 10

/** What one of the two imports says and asks, beside the way they share. */
interface ListImport<Counts, Row> {
  readonly title: string
  /** Under the title before a file is chosen. */
  readonly sub: string
  /** Where the import stands, the list it fills last. */
  readonly crumbs: readonly [Crumb, ...Crumb[]]
  readonly fields: readonly TableField[]
  readonly route: string
  /** The name of the empty table the first step hands out. */
  readonly template: string
  /** What a table of this import looks like, beside its file. */
  readonly hint: string
  readonly columnsNote: string
  readonly tiles: (counts: Counts, done: boolean) => readonly Tile[]
  /** How many things the plan makes; none, and there is nothing to take over. */
  readonly total: (counts: Counts) => number
  readonly summary: (counts: Counts) => string
  /** The words on the button that takes over. */
  readonly take: (counts: Counts) => string
  /** The lines that are taken over, as a table and as cards. */
  readonly rows: (shown: readonly Row[], footer: ReactNode) => ReactNode
  /** How the lines of the table of the preview are counted: "5 von 1.209 Zeilen". */
  readonly counting: (shown: number, counts: Counts) => string
  /** Under what a line holds and its kind has no use for. */
  readonly leftOut: string
  /** What the preview says of the figures it asks about once more, where the import has such. */
  readonly asked?: { readonly title: string; readonly caption: string; readonly note: string }
  /** What is said under the preview, the last of it beside whether the button is on. */
  readonly notes: readonly [string, string]
  readonly nothing: string
  /** What is said once it is taken over, and what is left to do by hand. */
  readonly done: string
  readonly next: string
  readonly back: string
  /** What the device holds anew once the list is taken over. */
  readonly after: (queries: QueryClient) => Promise<void>
}

/** The lines of a preview, ten at first and all of them on request. */
function RowsOf<Counts, Row>({
  preview,
  page,
}: {
  readonly preview: Preview<Counts, Row>
  readonly page: ListImport<Counts, Row>
}) {
  const [all, setAll] = useState(false)
  const shown = all ? preview.rows : preview.rows.slice(0, shownAtFirst)

  if (preview.rows.length === 0) {
    return null
  }

  return page.rows(
    shown,
    <>
      <span>{page.counting(shown.length, preview.counts)}</span>
      <div className="grow" />
      {!all && preview.rows.length > shownAtFirst ? (
        <button
          type="button"
          className="underline"
          onClick={() => {
            setAll(true)
          }}
        >
          Alle zeigen
        </button>
      ) : all && preview.moreRows > 0 ? (
        <span>und {preview.moreRows.toLocaleString('de-DE')} weitere</span>
      ) : null}
    </>,
  )
}

/** The two steps of an import that brings its table and nothing else. */
function ListImportScreen<Counts, Row>({ page }: { readonly page: ListImport<Counts, Row> }) {
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const table = useTable(page.fields, page.route)
  const [step, setStep] = useState<'columns' | 'preview' | 'done'>('columns')
  const [preview, setPreview] = useState<Preview<Counts, Row> | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [made, setMade] = useState<Counts | null>(null)
  const list = page.crumbs[page.crumbs.length - 1] ?? page.crumbs[0]
  const asked = { sheet: table.sheet, mapping: table.mapping }
  const leave = () => {
    void navigate({ to: list.to })
  }
  const working = (work: Promise<void>) => {
    setBusy(true)
    setTrouble(null)
    void work
      .catch((error: unknown) => {
        setTrouble(refusalOf(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }
  const showPreview = () => {
    working(
      sendTable<Preview<Counts, Row>>(`${page.route}/preview`, asked).then((answer) => {
        setPreview(answer)
        setStep('preview')
      }),
    )
  }
  const takeOver = () => {
    working(
      (async () => {
        const answer = await sendTable<{ counts: Counts }>(page.route, {
          ...asked,
          fileName: table.file?.name ?? '',
          expected: preview?.counts,
        })

        setMade(answer.counts)
        setStep('done')
        // What was made are records of the device: it fetches them.
        await client.synchronise()
        await page.after(queries)
      })(),
    )
  }
  const head = (
    <>
      <PageHead
        title={page.title}
        sub={
          step === 'columns' || !table.file
            ? page.sub
            : `${table.file.name}, ${linesWords(preview?.lines ?? table.lines)}`
        }
        crumbs={[...page.crumbs]}
        phoneBack={list}
      />
      <Steps
        label="Schritte des Imports"
        names={steps}
        current={step === 'columns' ? 0 : step === 'preview' ? 1 : 2}
      />
    </>
  )
  const refusal = trouble ? <NoteBox tone="conflict">{trouble}</NoteBox> : null

  if (step === 'done' && made) {
    return (
      <Screen>
        {head}
        <NoteBox tone="done">
          Übernommen: {page.summary(made)}. {page.done}
        </NoteBox>
        <CountTiles
          label="Was der Import übernommen hat"
          className={fourTiles}
          tiles={page.tiles(made, true)}
        />
        <NoteBox>{page.next}</NoteBox>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            icon={Upload}
            onClick={() => {
              setStep('columns')
              setPreview(null)
              setMade(null)
            }}
          >
            Weitere Liste importieren
          </Button>
          <Button tone="primary" icon={ChevronRight} onClick={leave}>
            {page.back}
          </Button>
        </div>
      </Screen>
    )
  }

  if (step === 'preview' && preview) {
    const total = page.total(preview.counts)
    const open = preview.problems.length + preview.moreProblems

    return (
      <Screen>
        {head}
        <CountTiles
          label="Was die Liste übernehmen würde"
          className={fourTiles}
          tiles={page.tiles(preview.counts, false)}
        />
        <ProblemsPanel problems={preview.problems} more={preview.moreProblems} />
        {page.asked ? (
          <NotesPanel
            notes={preview.jumps ?? []}
            more={preview.moreJumps ?? 0}
            title={page.asked.title}
            caption={page.asked.caption}
            note={page.asked.note}
          />
        ) : null}
        <NotesPanel notes={preview.notes} more={preview.moreNotes} note={page.leftOut} />
        <RowsOf preview={preview} page={page} />
        <NoteBox>{page.notes[0]}</NoteBox>
        <NoteBox tone={open > 0 ? 'waiting' : 'neutral'}>
          {page.notes[1]} Übernommen wird ganz oder gar nicht.{' '}
          {open > 0
            ? 'Solange etwas zu klären ist, bleibt der Knopf aus. Berichtigen Sie die Liste und wählen Sie sie im ersten Schritt neu.'
            : total === 0
              ? page.nothing
              : ''}
        </NoteBox>
        {refusal}
        <StepActions
          back={() => {
            setStep('columns')
          }}
          onCancel={leave}
        >
          <Button
            tone="primary"
            icon={Check}
            disabled={busy || open > 0 || total === 0}
            onClick={takeOver}
          >
            {page.take(preview.counts)}
          </Button>
        </StepActions>
      </Screen>
    )
  }

  return (
    <Screen>
      {head}
      <TableFilePanel
        file={table.file}
        sheet={table.sheetIndex}
        onSheet={table.choose}
        onFile={table.read}
        busy={table.busy}
        problem={table.problem}
        hint={
          <>
            {page.hint} Excel (.xlsx) oder CSV.{' '}
            <TemplateButton fields={page.fields} name={page.template} />
          </>
        }
      />
      {table.sheet ? (
        <ColumnsPanel
          sheet={table.sheet}
          fields={page.fields}
          mapping={table.mapping}
          onChange={table.setMapping}
          note={page.columnsNote}
        />
      ) : null}
      {refusal}
      <StepActions onCancel={leave}>
        <Button
          tone="primary"
          icon={ChevronRight}
          disabled={busy || !table.ready}
          onClick={showPreview}
        >
          Weiter zur Vorschau
        </Button>
      </StepActions>
    </Screen>
  )
}

/** A page that says who imports, to whoever does not. */
function MayNot({
  title,
  crumbs,
  children,
}: {
  readonly title: string
  readonly crumbs: readonly [Crumb, ...Crumb[]]
  readonly children: ReactNode
}) {
  return (
    <Screen>
      <PageHead
        title={title}
        crumbs={[...crumbs]}
        phoneBack={crumbs[crumbs.length - 1] ?? crumbs[0]}
      />
      <Empty>{children}</Empty>
    </Screen>
  )
}

const known = (count: number, done: boolean, sub: string): Tile => ({
  value: count,
  label: done ? 'Gab es schon' : 'Gibt es schon',
  sub,
})

const meterImport: ListImport<MeterImportCounts, MeterImportRow> = {
  title: 'Zählerstände importieren',
  sub: 'Stände, Zählertausche und Stilllegungen aus einer Liste oder einer Vorgängeranwendung',
  crumbs: [meterListPlace],
  fields: meterImportFields,
  route: importRoutes.meters,
  template: 'vorlage-zaehler.csv',
  hint: 'Eine Zeile je Eintrag an einer Messstelle: ein Stand mit dem Tag der Ablesung, der Tausch des Zählers oder eine Stilllegung.',
  columnsNote:
    'Eine Zeile nennt ihre Messstelle mit Zählernummer, Anlagennummer, Kennzeichen oder Seriennummer. Ohne die Spalte „Eintrag“ ist eine Zeile ein Stand.',
  tiles: (counts, done) => [
    { value: counts.readings, label: 'Zählerstände' },
    { value: counts.exchanges, label: 'Zählertausche' },
    { value: counts.pauses, label: 'Stilllegungen' },
    known(
      counts.known,
      done,
      done ? 'nicht doppelt übernommen' : 'werden nicht doppelt übernommen',
    ),
  ],
  total: meterImportTotal,
  summary: meterImportSummary,
  take: (counts) => `${linesWords(meterImportTotal(counts))} übernehmen`,
  counting: (shown, counts) =>
    `${shown.toLocaleString('de-DE')} von ${linesWords(meterImportTotal(counts))}`,
  rows: (shown, footer) => {
    const meter = (row: MeterImportRow) => (
      <Link to={meterPlaces.meter(row.meter.id)}>{row.meter.number ?? row.meter.name}</Link>
    )

    return (
      <TablePanel
        title="Übernommen wird"
        caption="Zeilen der Liste, die übernommen werden, mit Messstelle, Eintrag, Tag und dem, was daraus wird"
        cards={shown.map((row) => ({
          key: String(row.line),
          title: (
            <>
              {meter(row)} · {meterImportEntryLabel[row.entry]}
            </>
          ),
          sub: [
            `Zeile ${String(row.line)}`,
            // The number alone says little on a phone; the table has the name on its second line.
            row.meter.number === null ? null : row.meter.name,
            date(row.day),
            row.what,
            row.jump,
          ]
            .filter(Boolean)
            .join(' · '),
        }))}
        footer={footer}
      >
        <thead>
          <tr>
            <Column numeric className="w-[64px] min-w-[56px]">
              Zeile
            </Column>
            <Column className="w-[230px] min-w-[150px]">Messstelle</Column>
            <Column className="w-[110px] min-w-[96px]">Eintrag</Column>
            <Column numeric className="w-[104px] min-w-[96px]">
              Tag
            </Column>
            <Column className="min-w-[220px]">Was daraus wird</Column>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.line}>
              <Cell numeric>{row.line}</Cell>
              <Cell>
                <div className="font-medium">{meter(row)}</div>
                {row.meter.number === null ? null : (
                  <div className="text-[12px] text-ink-faint">{row.meter.name}</div>
                )}
              </Cell>
              <Cell>{meterImportEntryLabel[row.entry]}</Cell>
              <Cell numeric>{date(row.day)}</Cell>
              <Cell className="[overflow-wrap:anywhere]">
                <div>{row.what}</div>
                {row.jump === null ? null : (
                  <div className="mt-0.5 text-[12px] leading-[1.35] text-waiting">{row.jump}</div>
                )}
              </Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
    )
  },
  leftOut: 'Das bleibt draußen. Die Zeilen werden trotzdem übernommen.',
  asked: {
    title: 'Weit über dem Stand davor',
    caption: 'Stände der Liste, die weit über dem Stand davor liegen',
    note: 'Diese Stände werden übernommen. Wer die Liste übernimmt, bestätigt sie damit.',
  },
  notes: [
    'Ein übernommener Stand gilt für den Stichtag seines Tags und wird geprüft wie jeder andere: gegen die Stände davor und danach und gegen die Tausche. Er trägt die Quelle „Übernommen“: abgelesen hat ihn hier niemand.',
    'Die Zählernummer einer Messstelle ändert der Import nicht: der jüngste Tausch der Liste endet in der Nummer, die die Anlage trägt.',
  ],
  nothing: 'In dieser Liste steht nichts, was es nicht schon gibt.',
  done: 'Der Import steht im Änderungsprotokoll, und jeder Stand, jeder Tausch und jede Stilllegung mit einem eigenen Eintrag.',
  next: 'Der Verbrauch rechnet sich aus den Ständen und steht auf der Seite jeder Messstelle. Wandlerfaktor, Hauptzähler und Notiz tragen Sie dort ein.',
  back: 'Zu den Zählern',
  after: async (queries) => {
    await queries.invalidateQueries({ queryKey: ['meters'] })
  },
}

/** The import of readings, replacements and rests of the meters, under "Zähler". */
export function ImportMetersScreen() {
  const keeps = useRight('asset.write')
  const reads = useRight('reading.write')

  if (!keeps || !reads) {
    return (
      <MayNot title={meterImport.title} crumbs={meterImport.crumbs}>
        Zählerstände, Zählertausche und Stilllegungen importiert, wer Anlagen pflegt und Zähler
        abliest.
      </MayNot>
    )
  }

  return <ListImportScreen page={meterImport} />
}

const templateImport: ListImport<TemplateImportCounts, TemplateImportRow> = {
  title: 'Vorlagen importieren',
  sub: 'Vorlagen der Rundgänge aus einer Liste oder einer Vorgängeranwendung',
  crumbs: [roundsPlace, templateListPlace],
  fields: templateImportFields,
  route: importRoutes.templates,
  template: 'vorlage-vorlagen.csv',
  hint: 'Eine Zeile je Punkt: die Vorlage, ihr Kapitel und was geprüft, gemessen oder gefragt wird.',
  columnsNote:
    'Eine Zeile ist ein Punkt. Worauf ein Punkt zeigt und welche Pflicht er erfüllt, tragen Sie nach der Übernahme im Editor ein.',
  tiles: (counts, done) => [
    { value: counts.templates, label: 'Vorlagen' },
    { value: counts.chapters, label: 'Kapitel' },
    { value: counts.points, label: 'Punkte' },
    known(counts.known, done, 'Zeilen von Vorlagen, die bleiben'),
  ],
  total: (counts) => counts.templates,
  summary: templateImportSummary,
  take: (counts) => `${counted(counts.templates, 'Vorlage', 'Vorlagen')} übernehmen`,
  counting: (shown, counts) =>
    `${shown.toLocaleString('de-DE')} von ${counted(counts.templates, 'Vorlage', 'Vorlagen')}`,
  rows: (shown, footer) => {
    const size = (row: TemplateImportRow) =>
      `${row.chapters.toLocaleString('de-DE')} Kapitel, ${counted(row.points, 'Punkt', 'Punkte')}`
    const countersigned = (row: TemplateImportRow) =>
      row.asksCountersignature ? countersignatureWords.asked : countersignatureWords.none

    return (
      <TablePanel
        title="Übernommen wird"
        caption="Vorlagen der Liste, die übernommen werden, mit Umfang, Grenzwerten und Gegenzeichnung"
        cards={shown.map((row) => ({
          key: String(row.line),
          title: row.title,
          sub: [
            `Zeile ${String(row.line)}`,
            size(row),
            row.limits === 0 ? null : counted(row.limits, 'Grenzwert', 'Grenzwerte'),
            row.asksCountersignature ? 'Gegenzeichnung verlangt' : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }))}
        footer={footer}
      >
        <thead>
          <tr>
            <Column numeric className="w-[64px] min-w-[56px]">
              Zeile
            </Column>
            <Column className="min-w-[200px]">Vorlage</Column>
            <Column className="w-[200px] min-w-[150px]">Umfang</Column>
            <Column numeric className="w-[110px] min-w-[96px]">
              Grenzwerte
            </Column>
            <Column className="w-[150px] min-w-[130px]">Gegenzeichnung</Column>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.line}>
              <Cell numeric>{row.line}</Cell>
              <Cell className="font-medium [overflow-wrap:anywhere]">{row.title}</Cell>
              <Cell>{size(row)}</Cell>
              <Cell numeric>{row.limits}</Cell>
              <Cell>{countersigned(row)}</Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
    )
  },
  leftOut: 'Das bleibt draußen. Die Punkte werden trotzdem übernommen.',
  notes: [
    'Jede Vorlage kommt mit ihrer ersten Fassung und gehört Ihnen wie eine hier begonnene. Eine Vorlage, die es unter ihrer Bezeichnung schon gibt, bleibt, wie sie ist.',
    'Worauf ein Punkt zeigt, eine Anlage oder ein Raum, und welche Pflicht er erfüllt, sagt keine Liste: das tragen Sie danach im Editor ein, als nächste Fassung.',
  ],
  nothing: 'In dieser Liste steht keine Vorlage, die es nicht schon gibt.',
  done: 'Der Import steht im Änderungsprotokoll, und jede Vorlage mit einem eigenen Eintrag.',
  next: 'Öffnen Sie jede Vorlage und sagen Sie an ihren Punkten, welche Anlage oder welchen Raum sie meinen. Wo, wie oft und von wem ein Rundgang gegangen wird, legen Sie unter „Pläne“ an.',
  back: 'Zu den Vorlagen',
  after: async (queries) => {
    await queries.invalidateQueries({ queryKey: ['round-templates'] })
  },
}

/** The import of templates of rounds, under "Vorlagen". */
export function ImportTemplatesScreen() {
  const keeps = useRight('template.write')

  if (!keeps) {
    return (
      <MayNot title={templateImport.title} crumbs={templateImport.crumbs}>
        Vorlagen der Rundgänge importiert, wer sie führt.
      </MayNot>
    )
  }

  return <ListImportScreen page={templateImport} />
}
