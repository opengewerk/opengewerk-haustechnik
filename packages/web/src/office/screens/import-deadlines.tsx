import {
  type DeadlineImportCounts,
  deadlineImportFields,
  type DeadlineImportRow,
  deadlineImportSummary,
  deadlineImportTotal,
  dueFromWords,
  fileNameKey,
  type ImportNote,
  type ImportProblem,
  untitledDocument,
} from '@opengewerk/haustechnik-domain'
import { Button, Cell, Column, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { prepareVersion } from '@opengewerk/platform-web/attachments'
import { date, fileSize } from '@opengewerk/platform-web/format'
import {
  ColumnsPanel,
  NoteBox,
  PageHead,
  Screen,
  sendTable,
  Steps,
  TableFilePanel,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { useSync } from '@opengewerk/platform-web/sync'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, ChevronRight, FileText, History, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { CountTiles } from '../count-tiles.js'
import { dutyRegisterPlace } from '../duty-addresses.js'
import { importRoutes } from '../import-addresses.js'
import { officePlaces } from '../place-addresses.js'
import {
  linesWords,
  MayNot,
  NotesPanel,
  ProblemsPanel,
  refusalOf,
  StepActions,
  TemplateButton,
  useTable,
} from './imports.js'

/**
 * The import of the running deadlines of a predecessor application and its
 * old evidence (#130, section 11 of the concept), under "Pflichten".
 *
 * It goes the way of every import: a file is chosen and read by the server,
 * its columns are given to fields, the server says what the lines would make
 * and writes nothing while it does, and one press takes all of it over or
 * none of it. Beside the table stand the files of the old evidence. A line
 * names its file; the files a line names go up ahead of the take-over, as
 * the file of a report does, and the take-over names them by their hash.
 */

interface DeadlinePreview {
  readonly lines: number
  readonly counts: DeadlineImportCounts
  readonly problems: readonly ImportProblem[]
  readonly moreProblems: number
  readonly notes: readonly ImportNote[]
  readonly moreNotes: number
  readonly rows: readonly DeadlineImportRow[]
  readonly moreRows: number
  /** The files the lines name, which go up before the take-over. */
  readonly files: readonly string[]
  /** How many of the chosen files no line names. */
  readonly unusedFiles: number
}

const deadlineSteps = ['Datei und Spalten', 'Vorschau'] as const

/** Four figures over a preview: two beside each other on a phone, all four from 1024 pixels. */
const fourTiles = 'grid-cols-2 lg:grid-cols-4'

/** How many lines the preview shows before somebody asks for all of them. */
const shownAtFirst = 10

const filesWords = (count: number) =>
  count === 1 ? '1 Datei' : `${count.toLocaleString('de-DE')} Dateien`

/** The mark of everything that is taken over, with what the line says beside it. */
function LegacyMark({ note }: { readonly note: string | null }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Status tone="neutral" icon={History}>
        Altbestand
      </Status>
      {note === null ? null : (
        <span className="text-[12px] leading-[1.35] text-ink-faint [overflow-wrap:anywhere]">
          {note}
        </span>
      )}
    </div>
  )
}

/** What a line says beside its mark: its own remark, or that it is filed as a document. */
function noteOf(row: DeadlineImportRow): string | null {
  return row.becomes === 'document'
    ? row.duty === null
      ? 'als Dokument'
      : 'älterer Nachweis, als Dokument'
    : row.remark
}

/** The lines that are taken over, each with what becomes of it. */
function RowsPanel({
  rows,
  more,
  total,
}: {
  readonly rows: readonly DeadlineImportRow[]
  readonly more: number
  readonly total: number
}) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, shownAtFirst)

  if (rows.length === 0) {
    return null
  }

  const asset = (row: DeadlineImportRow) => (
    <Link to={officePlaces.asset(row.asset.id)}>{row.asset.number ?? row.asset.name}</Link>
  )
  const due = (row: DeadlineImportRow) =>
    row.dueOn === null ? '' : `${date(row.dueOn)}, ${dueFromWords[row.dueFrom]}`

  return (
    <TablePanel
      title="Übernommen wird"
      caption="Zeilen der Liste, die übernommen werden, mit Anlage, Pflicht, letztem Nachweis und nächster Fälligkeit"
      cards={shown.map((row) => ({
        key: String(row.line),
        title: (
          <>
            {asset(row)} · {row.duty ?? row.file}
          </>
        ),
        sub: [
          `Zeile ${String(row.line)}`,
          row.performedOn === null ? null : date(row.performedOn),
          row.dueOn === null ? null : `fällig ${due(row)}`,
          row.duty === null ? null : row.file,
          row.confirms ? 'Pflicht wird bestätigt' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        right: <LegacyMark note={noteOf(row)} />,
      }))}
      footer={
        <>
          <span>
            {shown.length.toLocaleString('de-DE')} von {total.toLocaleString('de-DE')} Zeilen
          </span>
          <div className="grow" />
          {!all && rows.length > shownAtFirst ? (
            <button
              type="button"
              className="underline"
              onClick={() => {
                setAll(true)
              }}
            >
              Alle zeigen
            </button>
          ) : all && more > 0 ? (
            <span>und {more.toLocaleString('de-DE')} weitere</span>
          ) : null}
        </>
      }
    >
      <thead>
        <tr>
          <Column numeric className="w-[64px] min-w-[56px]">
            Zeile
          </Column>
          <Column className="w-[180px] min-w-[130px]">Anlage</Column>
          <Column className="min-w-[170px]">Pflicht</Column>
          <Column numeric className="w-[116px] min-w-[104px]">
            Letzter Nachweis
          </Column>
          <Column numeric className="w-[124px] min-w-[112px]">
            Nächste Fälligkeit
          </Column>
          <Column className="w-[200px] min-w-[150px]">Vermerk</Column>
          <Column className="w-[170px] min-w-[130px]">Datei</Column>
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => (
          <tr key={row.line}>
            <Cell numeric>{row.line}</Cell>
            <Cell>
              <div className="font-medium">{asset(row)}</div>
              {row.asset.number === null ? null : (
                <div className="text-[12px] text-ink-faint">{row.asset.name}</div>
              )}
            </Cell>
            <Cell>
              <div className={row.confirms ? 'font-medium' : undefined}>{row.duty ?? ''}</div>
              {row.confirms ? (
                <div className="text-[12px] text-ink-faint">wird bestätigt</div>
              ) : null}
            </Cell>
            <Cell numeric>{row.performedOn === null ? '' : date(row.performedOn)}</Cell>
            <Cell numeric>
              {row.dueOn === null ? null : (
                <>
                  <div>{date(row.dueOn)}</div>
                  <div className="text-[12px] text-ink-faint">{dueFromWords[row.dueFrom]}</div>
                </>
              )}
            </Cell>
            <Cell>
              <LegacyMark note={noteOf(row)} />
            </Cell>
            <Cell className="[overflow-wrap:anywhere]">{row.file ?? ''}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The import of running deadlines and old evidence, under "Pflichten". */
export function ImportDeadlinesScreen() {
  const keepsDuties = useRight('duty.write')
  const entersEvidence = useRight('evidence.write')
  const client = useSync()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const table = useTable(deadlineImportFields, importRoutes.deadlines)
  const picker = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<readonly File[]>([])
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const [step, setStep] = useState<'columns' | 'preview' | 'done'>('columns')
  const [preview, setPreview] = useState<DeadlinePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [made, setMade] = useState<DeadlineImportCounts | null>(null)

  if (!keepsDuties || !entersEvidence) {
    return (
      <MayNot title="Fristen importieren" crumb={dutyRegisterPlace}>
        Laufende Fristen und alte Nachweise importiert, wer das Pflichtenverzeichnis führt und
        Nachweise einträgt.
      </MayNot>
    )
  }

  const asked = {
    sheet: table.sheet,
    mapping: table.mapping,
  }
  const leave = () => {
    void navigate({ to: dutyRegisterPlace.to })
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
        setProgress(null)
      })
  }
  const choose = (picked: readonly File[]) => {
    const names = new Set<string>()
    const twice = picked.find((file) => {
      const key = fileNameKey(file.name)
      const seen = names.has(key)

      names.add(key)

      return seen
    })

    // A line names its file by its name, so two of one name cannot both be meant.
    setFileProblem(
      twice
        ? `Die Datei „${twice.name}“ ist zweimal gewählt. Eine Zeile nennt ihre Datei beim Namen, also hat jede ihren eigenen.`
        : null,
    )
    setFiles(twice ? [] : picked)
  }
  const showPreview = () => {
    working(
      sendTable<DeadlinePreview>(`${importRoutes.deadlines}/preview`, {
        ...asked,
        files: files.map((file) => ({ name: file.name })),
      }).then((answer) => {
        setPreview(answer)
        setStep('preview')
      }),
    )
  }
  const takeOver = () => {
    working(
      (async () => {
        const named = new Set((preview?.files ?? []).map(fileNameKey))
        const needed = files.filter((file) => named.has(fileNameKey(file.name)))
        const sent = new Map<
          string,
          { name: string; sha256: string; sizeBytes: number; previewSha256: string | null }
        >()

        // The bytes go up ahead of the import, which names them.
        for (const [index, file] of needed.entries()) {
          setProgress(
            `${filesWords(needed.length)}: ${String(index + 1)} von ${String(needed.length)} wird vorbereitet`,
          )

          // An old evidence stays as it arrived: it is the evidence.
          const prepared = await prepareVersion(client, file, {
            untitled: untitledDocument,
            keepOriginal: true,
          })

          if ('problem' in prepared) {
            setTrouble(prepared.problem)

            return
          }

          sent.set(file.name, {
            name: file.name,
            sha256: prepared.sha256,
            sizeBytes: prepared.sizeBytes,
            previewSha256: prepared.previewSha256,
          })
        }

        if (needed.length > 0) {
          setProgress(`${filesWords(needed.length)} werden hochgeladen`)
          await client.synchronise()
        }

        setProgress('Die Liste wird übernommen')

        const answer = await sendTable<{ counts: DeadlineImportCounts }>(importRoutes.deadlines, {
          ...asked,
          // Every chosen file by its name, as the preview saw them; with its hash where a line names it.
          files: files.map((file) => sent.get(file.name) ?? { name: file.name }),
          fileName: table.file?.name ?? '',
          expected: preview?.counts,
        })

        setMade(answer.counts)
        setStep('done')
        // Duties and documents are records of the device: it fetches what was made.
        await client.synchronise()
        await queries.invalidateQueries({ queryKey: ['duties'] })
        await queries.invalidateQueries({ queryKey: ['evidence'] })
        queries.removeQueries({ queryKey: ['assets'] })
      })(),
    )
  }
  const sub =
    step === 'columns' || !table.file
      ? 'Laufende Fristen und alte Nachweise aus einer Liste oder einer Vorgängeranwendung'
      : [
          table.file.name,
          linesWords(preview?.lines ?? table.lines),
          files.length === 0 ? null : filesWords(files.length),
        ]
          .filter(Boolean)
          .join(', ')
  const head = (
    <>
      <PageHead
        title="Fristen importieren"
        sub={sub}
        crumbs={[dutyRegisterPlace]}
        phoneBack={dutyRegisterPlace}
      />
      <Steps
        label="Schritte des Imports"
        names={deadlineSteps}
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
          Übernommen: {deadlineImportSummary(made)}. Der Import steht im Änderungsprotokoll, und
          jede Pflicht, jeder Nachweis und jedes Dokument mit einem eigenen Eintrag.
        </NoteBox>
        <CountTiles
          label="Was der Import übernommen hat"
          className={fourTiles}
          tiles={[
            { value: made.evidence, label: 'Nachweise als Altbestand' },
            { value: made.duties, label: 'Pflichten bestätigt' },
            { value: made.documents, label: 'Dokumente als Altbestand' },
            { value: made.known, label: 'Gab es schon', sub: 'nicht doppelt übernommen' },
          ]}
        />
        <NoteBox>
          Wer für eine Pflicht verantwortlich ist und wer sie ausführt, tragen Sie im
          Pflichtenverzeichnis nach. Die Fristen stehen nach dem nächsten Lauf unter „Fristen“.
        </NoteBox>
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
            Zum Pflichtenverzeichnis
          </Button>
        </div>
      </Screen>
    )
  }

  if (step === 'preview' && preview) {
    const total = deadlineImportTotal(preview.counts)
    const open = preview.problems.length + preview.moreProblems

    return (
      <Screen>
        {head}
        <CountTiles
          label="Was die Liste übernehmen würde"
          className={fourTiles}
          tiles={[
            { value: preview.counts.evidence, label: 'Nachweise als Altbestand' },
            { value: preview.counts.duties, label: 'Pflichten werden bestätigt' },
            { value: preview.counts.documents, label: 'Dokumente als Altbestand' },
            {
              value: preview.counts.known,
              label: 'Gibt es schon',
              sub: 'werden nicht doppelt übernommen',
            },
          ]}
        />
        <ProblemsPanel problems={preview.problems} more={preview.moreProblems} />
        <NotesPanel
          notes={preview.notes}
          more={preview.moreNotes}
          note="Diese Zeilen bleiben draußen. Alle anderen werden übernommen."
        />
        <RowsPanel rows={preview.rows} more={preview.moreRows} total={total} />
        {preview.unusedFiles > 0 ? (
          <NoteBox>
            {preview.unusedFiles === 1
              ? '1 gewählte Datei nennt keine Zeile. Sie wird nicht übernommen.'
              : `${preview.unusedFiles.toLocaleString('de-DE')} gewählte Dateien nennt keine Zeile. Sie werden nicht übernommen.`}
          </NoteBox>
        ) : null}
        <NoteBox>
          Keine Frist beginnt beim Wechsel neu zu laufen: der letzte Nachweis und die nächste
          Fälligkeit kommen mit. Steht eine Pflicht an ihrer Anlage noch nicht, bestätigt der Import
          sie.
        </NoteBox>
        <NoteBox tone={open > 0 ? 'waiting' : 'neutral'}>
          Ein übernommener Nachweis trägt überall den Vermerk Altbestand, auch im PDF: er ist nicht
          in dieser Anwendung unterschrieben. Ältere Nachweise kommen als Dokumente mit ihrer
          ursprünglichen Datei; nichts wird neu unterschrieben oder umgeschrieben. Übernommen wird
          ganz oder gar nicht.{' '}
          {open > 0
            ? 'Solange etwas zu klären ist, bleibt der Knopf aus. Berichtigen Sie die Liste und wählen Sie sie im ersten Schritt neu.'
            : total === 0
              ? 'In dieser Liste steht nichts, was es nicht schon gibt.'
              : ''}
        </NoteBox>
        {progress ? <NoteBox>{progress}</NoteBox> : null}
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
            {linesWords(total)} übernehmen
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
            Eine Zeile je Nachweis: die Anlage, die Pflicht, der Tag des letzten Nachweises und die
            nächste Fälligkeit. Eine Zeile ohne Pflicht ist ein Dokument an ihrer Anlage. Excel
            (.xlsx) oder CSV.{' '}
            <TemplateButton fields={deadlineImportFields} name="vorlage-fristen.csv" />
          </>
        }
      />
      {table.sheet ? (
        <>
          <Panel title="Dateien der Liste">
            <div className="flex flex-wrap items-center gap-3">
              <FileText size={22} strokeWidth={1.9} aria-hidden className="shrink-0" />
              <div className="min-w-0 grow leading-[1.35]">
                <div className="font-semibold">
                  {files.length === 0
                    ? 'Keine Datei gewählt'
                    : `${filesWords(files.length)} gewählt`}
                </div>
                {files.length === 0 ? null : (
                  <div className="text-[13px] text-ink-faint">
                    zusammen {fileSize(files.reduce((sum, file) => sum + file.size, 0))}
                  </div>
                )}
              </div>
              <input
                ref={picker}
                type="file"
                multiple
                className="sr-only"
                aria-label="Dateien der Liste wählen"
                tabIndex={-1}
                onChange={(event) => {
                  choose([...(event.target.files ?? [])])
                  event.target.value = ''
                }}
              />
              <Button
                size="small"
                icon={Upload}
                onClick={() => {
                  picker.current?.click()
                }}
              >
                Dateien wählen
              </Button>
            </div>
            <p className="mt-2.5 text-[13px] leading-[1.5] text-ink-faint">
              Die alten Nachweise selbst, meist als PDF. Eine Zeile nennt ihre Datei beim Namen;
              eine Datei kann zu mehreren Zeilen gehören.
            </p>
            {fileProblem ? (
              <p role="alert" className="mt-2 text-[13px] leading-[1.5] text-conflict">
                {fileProblem}
              </p>
            ) : null}
          </Panel>
          <ColumnsPanel
            sheet={table.sheet}
            fields={deadlineImportFields}
            mapping={table.mapping}
            onChange={table.setMapping}
            note="Eine Zeile nennt ihre Anlage mit Anlagennummer, Kennzeichen oder Seriennummer. Eine Zeile ohne Pflicht ist ein Dokument."
          />
        </>
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
