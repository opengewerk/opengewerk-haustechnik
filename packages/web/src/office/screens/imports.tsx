import {
  type AssetImportCounts,
  assetImportFields,
  assetImportSummary,
  type AssetKindName,
  buildingKindLabel,
  buildingKinds,
  type DuplicateDecision,
  federalStates,
  type ImportDuplicate,
  type ImportProblem,
  isGeneralKind,
  kindNameKey,
  kindNamesIn,
  type KnownPlace,
  ruleScopeNames,
  type StructureCounts,
  structureFields,
  structureSummary,
  structureTotal,
  suggestedKind,
  type ColumnMapping,
  fieldsWithoutColumn,
  lineWords,
  suggestedMapping,
  tableColumns,
  type TableField,
  type TableFile,
  tableLineCount,
  tableRecords,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Column,
  Panel,
  SelectField,
  Status,
  TablePanel,
} from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import {
  ColumnsPanel,
  Empty,
  FilterSelect,
  NoteBox,
  PageHead,
  readTableFile,
  Screen,
  sendTable,
  Steps,
  TableFilePanel,
} from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import { request, RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, Download, Upload } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { kindChoices } from '../../app/asset-values.js'
import { useAreas } from '../../session/areas.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { assetRegisterPlace } from '../asset-addresses.js'
import { CountTiles } from '../count-tiles.js'
import { importRoutes } from '../import-addresses.js'
import { officePlaces } from '../place-addresses.js'

/**
 * The two imports from a table (#100, sections 3 and 11 of the concept):
 * places from the property down to the room, and assets into them.
 *
 * Both go the same way. A file is chosen and read by the server; its columns
 * are given to fields; the server says what the lines would make, which of
 * them have to be put right and which name something that is there already,
 * and writes nothing while it does; and one press takes all of it over or
 * none of it. The assets go one step more in between, which gives the words
 * a list uses for kinds the asset kinds of the catalogue.
 *
 * What is chosen and decided lives in the screen and nowhere else: a table
 * that was looked at and left has left nothing behind.
 */

/** What a refusal says, or that the server was not reached: an import needs a connection. */
function refusalOf(error: unknown): string {
  return error instanceof RequestRefused
    ? error.message
    : 'Der Server ist nicht zu erreichen. Ein Import braucht eine Verbindung.'
}

/** What has to be put right before anything is taken over, with the lines it is about. */
function ProblemsPanel({
  problems,
  more,
}: {
  readonly problems: readonly ImportProblem[]
  readonly more: number
}) {
  if (problems.length === 0) {
    return null
  }

  return (
    <TablePanel
      title="Was vor der Übernahme zu klären ist"
      caption="Zeilen, die vor der Übernahme zu klären sind"
      cards={problems.map((problem) => ({
        key: `${problem.what}${problem.next}`,
        title: <span className="font-medium">{problem.what}</span>,
        sub: `Zeile ${lineWords(problem.lines)} · ${problem.next}`,
      }))}
      {...(more > 0 ? { footer: `und ${more.toLocaleString('de-DE')} weitere` } : {})}
    >
      <thead>
        <tr>
          <Column numeric className="w-[110px]">
            Zeile
          </Column>
          <Column>Was</Column>
          <Column className="w-[330px]">Wie es weitergeht</Column>
        </tr>
      </thead>
      <tbody>
        {problems.map((problem) => (
          <tr key={`${problem.what}${problem.next}`}>
            <Cell numeric>{lineWords(problem.lines)}</Cell>
            <Cell className="font-medium">{problem.what}</Cell>
            <Cell>{problem.next}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The buttons under a step: the way back at the left, giving up and going on at the right. */
function StepActions({
  back,
  onCancel,
  children,
}: {
  readonly back?: () => void
  readonly onCancel: () => void
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {back ? (
        <Button icon={ChevronLeft} onClick={back}>
          Zurück
        </Button>
      ) : null}
      <div className="grow" />
      <Button onClick={onCancel}>Abbrechen</Button>
      {children}
    </div>
  )
}

/** A file with the names of the fields as its first line, for whoever starts a list for the import. */
function TemplateButton({
  fields,
  name,
}: {
  readonly fields: readonly TableField[]
  readonly name: string
}) {
  return (
    <Button
      size="small"
      icon={Download}
      onClick={() => {
        // With the mark a spreadsheet reads the umlauts by, and the semicolon a German one divides by.
        const file = new Blob(
          [`${String.fromCharCode(0xfeff)}${fields.map((field) => field.label).join(';')}\r\n`],
          {
            type: 'text/csv;charset=utf-8',
          },
        )
        const address = URL.createObjectURL(file)
        const link = document.createElement('a')

        link.href = address
        link.download = name
        link.click()
        URL.revokeObjectURL(address)
      }}
    >
      Vorlage herunterladen
    </Button>
  )
}

/**
 * The file somebody chose with its sheet and the choice of its columns: read
 * by the server, with the columns the names of which say what they are given
 * to their fields already.
 */
function useTable(fields: readonly TableField[], route: string) {
  const [file, setFile] = useState<TableFile | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const sheet = file?.sheets[sheetIndex] ?? null

  const choose = (index: number, from: TableFile | null = file) => {
    const chosen = from?.sheets[index]

    setSheetIndex(index)
    setMapping(chosen ? suggestedMapping(tableColumns(chosen), fields) : {})
  }

  const read = (picked: File) => {
    setBusy(true)
    setProblem(null)
    void readTableFile(`${route}/table`, picked)
      .then((table) => {
        setFile(table)
        choose(0, table)
      })
      .catch((error: unknown) => {
        setProblem(refusalOf(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return {
    file,
    sheet,
    sheetIndex,
    mapping,
    setMapping,
    busy,
    problem,
    read,
    choose,
    /** Whether the columns are chosen far enough to go on. */
    ready: sheet !== null && fieldsWithoutColumn(mapping, fields).length === 0,
    lines: sheet ? tableLineCount(sheet) : 0,
  }
}

const linesWords = (count: number) =>
  count === 1 ? '1 Zeile' : `${count.toLocaleString('de-DE')} Zeilen`

/** In place of an import, for whoever may not run it. */
function MayNot({
  title,
  crumb,
  children,
}: {
  readonly title: string
  readonly crumb: { readonly to: string; readonly label: string }
  readonly children: ReactNode
}) {
  return (
    <Screen>
      <PageHead title={title} crumbs={[crumb]} phoneBack={crumb} />
      <Empty>{children}</Empty>
    </Screen>
  )
}

interface StructurePreview {
  readonly lines: number
  readonly counts: StructureCounts
  readonly problems: readonly ImportProblem[]
  readonly moreProblems: number
  readonly known: readonly KnownPlace[]
  readonly moreKnown: number
}

const structureSteps = ['Datei und Spalten', 'Vorschau'] as const

const states = [
  { value: '', label: 'Bitte wählen' },
  ...federalStates
    .map((state) => ({ value: state as string, label: ruleScopeNames[state] }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de')),
]

const kindsOfBuildings = [
  { value: '', label: 'Bitte wählen' },
  ...buildingKinds.map((kind) => ({ value: kind as string, label: buildingKindLabel[kind] })),
]

/** The import of properties, buildings, floors and rooms, under "Liegenschaften". */
export function ImportStructureScreen() {
  const may = useRight('location.write')
  const areas = useAreas()
  const client = useSync()
  const navigate = useNavigate()
  const table = useTable(structureFields, importRoutes.structure)
  const [step, setStep] = useState<'columns' | 'preview' | 'done'>('columns')
  const [areaId, setAreaId] = useState('')
  const [federalState, setFederalState] = useState('')
  const [buildingKind, setBuildingKind] = useState('')
  const [preview, setPreview] = useState<StructurePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [made, setMade] = useState<StructureCounts | null>(null)

  if (!may) {
    return (
      <MayNot title="Bestand importieren" crumb={officePlaces.list}>
        Den Bestand importiert, wer Liegenschaften, Gebäude und Geschosse pflegt.
      </MayNot>
    )
  }

  // A tenant with one area has nothing to choose: its properties go there.
  const [onlyArea] = areas.length === 1 ? areas : []
  const asked = {
    sheet: table.sheet,
    mapping: table.mapping,
    defaults: {
      areaId: (onlyArea?.id ?? areaId) || null,
      federalState: federalState || null,
      buildingKinds: buildingKind === '' ? [] : [buildingKind],
    },
  }
  const leave = () => {
    void navigate({ to: officePlaces.list.to })
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
      sendTable<StructurePreview>(`${importRoutes.structure}/preview`, asked).then((answer) => {
        setPreview(answer)
        setStep('preview')
      }),
    )
  }
  const takeOver = () => {
    working(
      sendTable<{ counts: StructureCounts }>(importRoutes.structure, {
        ...asked,
        fileName: table.file?.name ?? '',
        expected: preview?.counts,
      }).then(async (answer) => {
        setMade(answer.counts)
        setStep('done')
        // The places are records of the device: it fetches what was made.
        await client.synchronise()
      }),
    )
  }
  const sub =
    step === 'columns' || !table.file
      ? 'Liegenschaften, Gebäude, Geschosse und Räume aus einer Tabelle (CSV oder Excel)'
      : `${table.file.name}, ${linesWords(preview?.lines ?? table.lines)}`
  const head = (
    <>
      <PageHead
        title="Bestand importieren"
        sub={sub}
        crumbs={[officePlaces.list]}
        phoneBack={officePlaces.list}
      />
      <Steps
        label="Schritte des Imports"
        names={structureSteps}
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
          Übernommen: {structureSummary(made)}. Der Import steht als ein Eintrag im
          Änderungsprotokoll.
        </NoteBox>
        <CountTiles
          label="Was der Import angelegt hat"
          tiles={[
            { value: made.properties, label: 'Liegenschaften angelegt' },
            { value: made.buildings, label: 'Gebäude angelegt' },
            { value: made.floors, label: 'Geschosse angelegt' },
            { value: made.rooms, label: 'Räume angelegt' },
            { value: made.known, label: 'Gab es schon', sub: 'nicht doppelt angelegt' },
          ]}
        />
        <NoteBox>
          Gebäudeart, Baujahr und Ansprechpartner tragen Sie an Liegenschaft und Gebäude nach.
          Anlagen kommen mit einem eigenen Import oder vor Ort mit der Bestandsaufnahme.
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
            Weitere Datei importieren
          </Button>
          <Button tone="primary" icon={ChevronRight} onClick={leave}>
            Zu den Liegenschaften
          </Button>
        </div>
      </Screen>
    )
  }

  if (step === 'preview' && preview) {
    const total = structureTotal(preview.counts)
    const open = preview.problems.length + preview.moreProblems

    return (
      <Screen>
        {head}
        <CountTiles
          label="Was die Tabelle anlegen würde"
          tiles={[
            { value: preview.counts.properties, label: 'Liegenschaften neu' },
            { value: preview.counts.buildings, label: 'Gebäude neu' },
            { value: preview.counts.floors, label: 'Geschosse neu' },
            { value: preview.counts.rooms, label: 'Räume neu' },
            {
              value: preview.counts.known,
              label: 'Gibt es schon',
              tone: preview.counts.known > 0 ? 'waiting' : 'neutral',
              sub: 'werden nicht doppelt angelegt',
            },
          ]}
        />
        <ProblemsPanel problems={preview.problems} more={preview.moreProblems} />
        <KnownPanel known={preview.known} more={preview.moreKnown} />
        <NoteBox tone={open > 0 ? 'waiting' : 'neutral'}>
          Übernommen wird ganz oder gar nicht.{' '}
          {open > 0
            ? 'Solange etwas zu klären ist, bleibt der Knopf aus. Berichtigen Sie die Datei und wählen Sie sie im ersten Schritt neu. '
            : total === 0
              ? 'In dieser Tabelle steht nichts, was es nicht schon gibt. '
              : ''}
          Der Import steht danach als ein Eintrag im Änderungsprotokoll.
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
            {linesWords(preview.lines)} übernehmen
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
            Eine Zeile je Raum, mit seiner Liegenschaft, seinem Gebäude und seinem Geschoss in
            eigenen Spalten. Eine Zeile, die beim Gebäude oder beim Geschoss endet, legt nur diese
            an. Excel (.xlsx) oder CSV.{' '}
            <TemplateButton fields={structureFields} name="vorlage-bestand.csv" />
          </>
        }
      />
      {table.sheet ? (
        <>
          <ColumnsPanel
            sheet={table.sheet}
            fields={structureFields}
            mapping={table.mapping}
            onChange={table.setMapping}
            note="Flächen kommen mit Phase 3 an Gebäude und Räume; bis dahin bleibt eine solche Spalte draußen."
          />
          <Panel title="Was die Datei nicht sagt">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              {areas.length > 1 ? (
                <div className="w-full sm:w-[220px]">
                  <SelectField
                    label="Bereich neuer Liegenschaften"
                    value={areaId}
                    options={[
                      { value: '', label: 'Bitte wählen' },
                      ...areas.map((area) => ({ value: area.id as string, label: area.name })),
                    ]}
                    onChange={setAreaId}
                  />
                </div>
              ) : null}
              <div className="w-full sm:w-[240px]">
                <SelectField
                  label="Bundesland neuer Liegenschaften"
                  value={federalState}
                  options={states}
                  onChange={setFederalState}
                />
              </div>
              <div className="w-full sm:w-[300px]">
                <SelectField
                  label="Gebäudeart neuer Gebäude"
                  value={buildingKind}
                  options={kindsOfBuildings}
                  onChange={setBuildingKind}
                />
              </div>
            </div>
            <p className="mt-2.5 text-[13px] leading-[1.5] text-ink-faint">
              Liegenschaften und Gebäude, die es schon gibt, bleiben, wie sie sind. Die Ebene eines
              Geschosses liest der Import aus seiner Bezeichnung (EG, 1. OG, UG), wenn keine Spalte
              sie nennt.
            </p>
          </Panel>
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

const placePage: Readonly<Record<KnownPlace['table'], (id: string) => string>> = {
  properties: officePlaces.property,
  buildings: officePlaces.building,
  floors: officePlaces.floor,
  rooms: officePlaces.room,
}

/** The lines that name something that is there already, each with the way to it. */
function KnownPanel({
  known,
  more,
}: {
  readonly known: readonly KnownPlace[]
  readonly more: number
}) {
  if (known.length === 0) {
    return null
  }

  const link = (place: KnownPlace) => (
    <Link to={placePage[place.table](place.id)}>{place.existing}</Link>
  )

  return (
    <TablePanel
      title="Gibt es schon"
      caption="Zeilen, die nichts anlegen, weil es den Ort schon gibt"
      cards={known.map((place) => ({
        key: `${place.table}${place.id}`,
        title: place.inFile,
        sub: (
          <>
            Zeile {lineWords(place.lines)} · {link(place)}
          </>
        ),
      }))}
      {...(more > 0 ? { footer: `und ${more.toLocaleString('de-DE')} weitere` } : {})}
    >
      <thead>
        <tr>
          <Column numeric className="w-[110px]">
            Zeile
          </Column>
          <Column>In der Datei</Column>
          <Column className="w-[330px]">Schon vorhanden</Column>
        </tr>
      </thead>
      <tbody>
        {known.map((place) => (
          <tr key={`${place.table}${place.id}`}>
            <Cell numeric>{lineWords(place.lines)}</Cell>
            <Cell>{place.inFile}</Cell>
            <Cell>{link(place)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

interface AssetsPreview {
  readonly lines: number
  readonly counts: AssetImportCounts
  readonly problems: readonly ImportProblem[]
  readonly moreProblems: number
  readonly duplicates: readonly ImportDuplicate[]
}

const assetSteps = ['Datei und Spalten', 'Anlagenarten', 'Vorschau'] as const

const kindNamesQuery = {
  queryKey: ['imports', 'asset-kinds'],
  queryFn: () => request<{ names: AssetKindName[] }>(importRoutes.kindNames),
} as const

const duplicateChoices: readonly { readonly value: DuplicateDecision; readonly label: string }[] = [
  { value: 'skip', label: 'Nicht anlegen' },
  { value: 'take', label: 'Trotzdem anlegen' },
]

/**
 * What becomes of a line that may be an asset that is there, as two halves
 * of one control: one of the two, or neither while nobody has decided. Two
 * buttons side by side would not say that the answers shut each other out.
 */
function DecisionSwitch({
  line,
  value,
  onDecide,
}: {
  readonly line: number
  readonly value: DuplicateDecision | null
  readonly onDecide: (decision: DuplicateDecision) => void
}) {
  return (
    <div
      role="group"
      aria-label={`Zeile ${line}`}
      className="inline-flex gap-[2px] rounded-control border border-line bg-surface-sunken p-[3px]"
    >
      {duplicateChoices.map((choice) => {
        const chosen = choice.value === value

        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={chosen}
            onClick={() => {
              onDecide(choice.value)
            }}
            className={`h-[26px] cursor-pointer rounded-[3px] px-2.5 text-[13px] whitespace-nowrap max-lg:h-10 max-lg:px-3 max-lg:text-[15px] ${
              chosen ? 'bg-ink font-semibold text-ground' : 'bg-transparent text-ink'
            }`}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

/** The import of assets into buildings and rooms that are there, under "Anlagen". */
export function ImportAssetsScreen() {
  const may = useRight('asset.write')
  const catalogue = useCatalogue()
  const queries = useQueryClient()
  const navigate = useNavigate()
  const table = useTable(assetImportFields, importRoutes.assets)
  const kept = useQuery({ ...kindNamesQuery, enabled: may })
  const [step, setStep] = useState<'columns' | 'kinds' | 'preview' | 'done'>('columns')
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({})
  const [decisions, setDecisions] = useState<Readonly<Record<number, DuplicateDecision>>>({})
  const [preview, setPreview] = useState<AssetsPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [made, setMade] = useState<AssetImportCounts | null>(null)
  const names = useMemo(
    () => (table.sheet ? kindNamesIn(tableRecords(table.sheet, table.mapping)) : []),
    [table.sheet, table.mapping],
  )
  const kinds = useMemo(() => {
    const day = today()

    return catalogue === null
      ? []
      : kindChoices(catalogue).map((choice) => {
          const costGroup = catalogue.assetKind(choice.value, day)?.definition.costGroup ?? ''

          return {
            key: choice.value,
            costGroup,
            name: catalogue.assetKind(choice.value, day)?.definition.label ?? choice.label,
            label: isGeneralKind(choice.value) ? `${choice.label} (KG ${costGroup})` : choice.label,
          }
        })
  }, [catalogue])

  if (!may) {
    return (
      <MayNot title="Anlagen importieren" crumb={assetRegisterPlace}>
        Anlagen importiert, wer Anlagen pflegt.
      </MayNot>
    )
  }

  /** The kind of a word: what somebody chose here, what the tenant keeps, or what its name proposes. */
  const kindOf = (name: (typeof names)[number]): string => {
    const key = kindNameKey(name.name)
    const stored = kept.data?.names.find((entry) => kindNameKey(entry.name) === key)?.kind

    return (
      chosen[key] ??
      stored ??
      suggestedKind(
        name,
        kinds.map((kind) => ({ key: kind.key, label: kind.name, costGroup: kind.costGroup })),
      ) ??
      ''
    )
  }
  const leave = () => {
    void navigate({ to: assetRegisterPlace.to })
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
  const asked = { sheet: table.sheet, mapping: table.mapping }
  const keepAndPreview = () => {
    working(
      request<{ names: AssetKindName[] }>(importRoutes.kindNames, {
        method: 'PUT',
        body: JSON.stringify({
          names: names.map((name) => ({ name: name.name, kind: kindOf(name) })),
        }),
      })
        .then((answer) => {
          queries.setQueryData(kindNamesQuery.queryKey, answer)

          return sendTable<AssetsPreview>(`${importRoutes.assets}/preview`, asked)
        })
        .then((answer) => {
          setPreview(answer)
          setDecisions({})
          setStep('preview')
        }),
    )
  }
  const taken = Object.values(decisions).filter((decision) => decision === 'take').length
  const skipped = Object.values(decisions).filter((decision) => decision === 'skip').length
  const counts: AssetImportCounts = {
    assets: (preview?.counts.assets ?? 0) + taken,
    skipped,
    undecided: (preview?.duplicates.length ?? 0) - taken - skipped,
  }
  const takeOver = () => {
    working(
      sendTable<{ counts: AssetImportCounts }>(importRoutes.assets, {
        ...asked,
        decisions,
        fileName: table.file?.name ?? '',
        expected: counts,
      }).then((answer) => {
        setMade(answer.counts)
        setStep('done')
        // Register and files come from the server: what they showed is old now.
        queries.removeQueries({ queryKey: ['assets'] })
      }),
    )
  }
  const sub =
    step === 'columns' || !table.file
      ? 'Anlagen aus einer Tabelle (CSV oder Excel), in Gebäude und Räume, die es schon gibt'
      : step === 'kinds'
        ? 'Bezeichnungen aus der Datei, einmal zugeordnet und bei jedem weiteren Import genommen'
        : `${table.file.name}, ${linesWords(preview?.lines ?? table.lines)}`
  const head = (
    <>
      <PageHead
        title="Anlagen importieren"
        sub={sub}
        crumbs={[assetRegisterPlace]}
        phoneBack={assetRegisterPlace}
      />
      <Steps
        label="Schritte des Imports"
        names={assetSteps}
        current={step === 'columns' ? 0 : step === 'kinds' ? 1 : step === 'preview' ? 2 : 3}
      />
    </>
  )
  const refusal = trouble ? <NoteBox tone="conflict">{trouble}</NoteBox> : null

  if (step === 'done' && made) {
    return (
      <Screen>
        {head}
        <NoteBox tone="done">
          Übernommen: {assetImportSummary(made)}. Der Import steht als ein Eintrag im
          Änderungsprotokoll.
        </NoteBox>
        <NoteBox>
          Was nur eine Anlagenart hat, etwa Löschmittel oder Nennleistung, tragen Sie an der Anlage
          nach. Für jede Anlage schlägt der Katalog die Pflichten ihrer Anlagenart vor; der Import
          bestätigt keine.
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
            Weitere Datei importieren
          </Button>
          <Button tone="primary" icon={ChevronRight} onClick={leave}>
            Zu den Anlagen
          </Button>
        </div>
      </Screen>
    )
  }

  if (step === 'preview' && preview) {
    const open = preview.problems.length + preview.moreProblems
    const decide = (lines: readonly number[], decision: DuplicateDecision) => {
      setDecisions((before) => ({
        ...before,
        ...Object.fromEntries(lines.map((line) => [line, decision])),
      }))
    }
    const all = preview.duplicates.map((duplicate) => duplicate.line)

    return (
      <Screen>
        {head}
        <CountTiles
          label="Was die Tabelle anlegen würde"
          tiles={[
            { value: counts.assets, label: 'Anlagen neu' },
            {
              value: preview.duplicates.length,
              label: 'Gibt es vielleicht schon',
              tone: preview.duplicates.length > 0 ? 'waiting' : 'neutral',
              sub: 'Sie entscheiden je Zeile',
            },
            {
              value: preview.problems.reduce((sum, problem) => sum + problem.lines.length, 0),
              label: open === 1 ? 'Zeile offen' : 'Zeilen offen',
              tone: open > 0 ? 'conflict' : 'neutral',
              sub: 'vor der Übernahme zu klären',
            },
          ]}
        />
        <ProblemsPanel problems={preview.problems} more={preview.moreProblems} />
        {preview.duplicates.length > 0 ? (
          <TablePanel
            title="Gibt es vielleicht schon"
            caption="Zeilen, die eine Anlage nennen, die es vielleicht schon gibt"
            // On a phone a row is a box with its decision under it: a table
            // that scrolls sideways would hide the one thing that is asked.
            cards={preview.duplicates.map((duplicate) => ({
              key: String(duplicate.line),
              title: <span className="font-medium">{duplicate.name}</span>,
              sub: [
                `Zeile ${duplicate.line}`,
                ...duplicate.of.map((other) =>
                  'id' in other
                    ? `${other.number ?? 'Anlage'} ${other.name}`
                    : `Zeile ${other.line} dieser Datei`,
                ),
                duplicate.same,
              ].join(' · '),
              actions: (
                <DecisionSwitch
                  line={duplicate.line}
                  value={decisions[duplicate.line] ?? null}
                  onDecide={(decision) => {
                    decide([duplicate.line], decision)
                  }}
                />
              ),
            }))}
            action={
              <span className="flex flex-wrap gap-1.5">
                <Button
                  size="small"
                  onClick={() => {
                    decide(all, 'skip')
                  }}
                >
                  Alle nicht anlegen
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    decide(all, 'take')
                  }}
                >
                  Alle trotzdem anlegen
                </Button>
              </span>
            }
          >
            <thead>
              <tr>
                <Column numeric className="w-[64px]">
                  Zeile
                </Column>
                <Column>In der Datei</Column>
                <Column className="w-[300px]">Schon vorhanden</Column>
                <Column className="w-[270px]">Entscheidung</Column>
              </tr>
            </thead>
            <tbody>
              {preview.duplicates.map((duplicate) => (
                <tr key={duplicate.line}>
                  <Cell numeric>{duplicate.line}</Cell>
                  <Cell>{duplicate.name}</Cell>
                  <Cell>
                    {duplicate.of.map((other) =>
                      'id' in other ? (
                        <div key={other.id}>
                          <Link to={officePlaces.asset(other.id)}>{other.number ?? 'Anlage'}</Link>{' '}
                          {other.name}
                        </div>
                      ) : (
                        <div key={`line-${other.line}`}>Zeile {other.line} dieser Datei</div>
                      ),
                    )}
                    <div className="text-[12px] text-ink-faint">{duplicate.same}</div>
                  </Cell>
                  <Cell>
                    <DecisionSwitch
                      line={duplicate.line}
                      value={decisions[duplicate.line] ?? null}
                      onDecide={(decision) => {
                        decide([duplicate.line], decision)
                      }}
                    />
                  </Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        ) : null}
        <NoteBox tone={open > 0 || counts.undecided > 0 ? 'waiting' : 'neutral'}>
          Übernommen wird ganz oder gar nicht.{' '}
          {open > 0
            ? 'Solange etwas zu klären ist, bleibt der Knopf aus. Berichtigen Sie die Datei und wählen Sie sie im ersten Schritt neu. '
            : counts.undecided > 0
              ? 'Solange eine Dublette ohne Entscheidung ist, bleibt der Knopf aus. '
              : counts.assets === 0
                ? 'Von dieser Tabelle bleibt nichts, was anzulegen wäre. '
                : ''}
          Der Import steht danach als ein Eintrag im Änderungsprotokoll.
        </NoteBox>
        {refusal}
        <StepActions
          back={() => {
            setStep('kinds')
          }}
          onCancel={leave}
        >
          <Button
            tone="primary"
            icon={Check}
            disabled={busy || open > 0 || counts.undecided > 0 || counts.assets === 0}
            onClick={takeOver}
          >
            {counts.assets === 1
              ? '1 Anlage anlegen'
              : `${counts.assets.toLocaleString('de-DE')} Anlagen anlegen`}
          </Button>
        </StepActions>
      </Screen>
    )
  }

  if (step === 'kinds') {
    const options = [
      { value: '', label: 'Anlagenart wählen' },
      ...kinds.map((kind) => ({ value: kind.key, label: kind.label })),
    ]
    const open = names.filter((name) => kindOf(name) === '').length

    return (
      <Screen>
        {head}
        <TablePanel
          title="Anlagenarten zuordnen"
          caption="Bezeichnungen der Datei und ihre Anlagenart"
        >
          <thead>
            <tr>
              <Column className="w-[220px]">In der Datei</Column>
              <Column numeric className="w-[90px]">
                Anlagen
              </Column>
              <Column className="w-[380px]">Anlagenart im Katalog</Column>
              <Column>
                <span className="sr-only">Hinweis</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const kind = kindOf(name)

              return (
                <tr key={kindNameKey(name.name)}>
                  <Cell>
                    <code className="text-[13px] [overflow-wrap:anywhere]">{name.name}</code>
                  </Cell>
                  <Cell numeric>{name.count}</Cell>
                  <Cell>
                    <FilterSelect
                      label={`Anlagenart für ${name.name}`}
                      width="lg:w-[360px]"
                      value={kind}
                      options={options}
                      onChange={(value) => {
                        setChosen((before) => ({ ...before, [kindNameKey(name.name)]: value }))
                      }}
                    />
                  </Cell>
                  <Cell>
                    {kind === '' ? (
                      <Status tone="conflict">Noch offen</Status>
                    ) : isGeneralKind(kind) ? (
                      <span className="text-[12px] text-ink-faint">
                        Pflichten erst mit dem Fachpaket
                      </span>
                    ) : null}
                  </Cell>
                </tr>
              )
            })}
          </tbody>
        </TablePanel>
        <NoteBox>
          {catalogue === null
            ? 'Der Katalog ist auf diesem Gerät noch nicht geladen. Die Zuordnung wartet auf ihn.'
            : 'Nach dem Import schlägt das System für jede Anlage die Pflichten ihrer Anlagenart vor. Eine allgemeine Anlagenart trägt keine, bis das Paket für sie erscheint (Paket Allgemein).'}
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
            disabled={busy || open > 0 || names.length === 0}
            onClick={keepAndPreview}
          >
            Zuordnung speichern
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
            Eine Zeile je Anlage, mit ihrer Liegenschaft und ihrem Gebäude, wie sie hier heißen, und
            auf Wunsch ihrem Raum. Excel (.xlsx) oder CSV.{' '}
            <TemplateButton fields={assetImportFields} name="vorlage-anlagen.csv" />
          </>
        }
      />
      {table.sheet ? (
        <ColumnsPanel
          sheet={table.sheet}
          fields={assetImportFields}
          mapping={table.mapping}
          onChange={table.setMapping}
          note="Was nur eine Anlagenart hat, etwa Löschmittel oder Nennleistung, tragen Sie nach dem Import an der Anlage ein."
        />
      ) : null}
      {refusal}
      <StepActions onCancel={leave}>
        <Button
          tone="primary"
          icon={ChevronRight}
          disabled={busy || !table.ready}
          onClick={() => {
            setTrouble(null)
            setStep('kinds')
          }}
        >
          Weiter zu den Anlagenarten
        </Button>
      </StepActions>
    </Screen>
  )
}
