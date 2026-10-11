import {
  byProposedKind,
  type Catalogue,
  type CatalogueEntry,
  dismissedTableColumns,
  dutyIntervalProblem,
  type DutyKind,
  dutyLimits,
  type DutyPerformer,
  dutyPerformerLabel,
  dutyPerformers,
  type DutyProposal,
  type DutyProposals,
  type FederalState,
  intervalLine,
  type IsoDate,
  type ProposedAsset,
  proposedAssetName,
  qualificationLevelLabel,
  type RecordState,
  ruleValueWords,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  Cell,
  Choice,
  Column,
  Dialog,
  DialogActions,
  Field,
  Panel,
  PanelLabel,
  SelectField,
  TablePanel,
  TextArea,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, NoteBox, PageHead, Screen, useTableExport } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  RequestRefused,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { BookOpen, Check, ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ReviewMarks } from '../../app/review-marks.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt } from '../../sync/made-at.js'
import { dutyRegisterPlace } from '../duty-addresses.js'
import { officePlaces } from '../place-addresses.js'
import {
  confirmSearch,
  packageOf,
  type ProposalFilter,
  proposalFilterOf,
  proposalPlace,
  proposalPlaces,
  proposalRequest,
  proposalSearch,
  proposalTableRequest,
} from '../proposal-addresses.js'
import { LinkButton } from '../link-button.js'
import { factLink } from '../links.js'
import { RegisterFilter } from '../register-filter.js'
import { dutyColleaguesQuery, responsibleChoices } from './duty.js'

/**
 * The proposals of the catalogue in the office, `vorschlaege()` of the boards
 * (#102, sections 4.3, 2.3 and 5 of the concept): grouped by duty kind, each
 * group with its package, its source, its interval and who may perform it,
 * and the mark of an entry nobody with expertise has accepted. One group is
 * open with its assets, and the card "Auswahl" confirms or dismisses what is
 * chosen there in one batch; a row confirms one in the form of its own or
 * dismisses one with its reason.
 *
 * "Das System schlägt vor, der Betreiber entscheidet" (Leitentscheidung 4):
 * a proposal is worked out by the server each time it is read and is no
 * record; what is kept is the decision. Whoever keeps the register decides;
 * everybody else who reads duties sees the proposals without the buttons.
 */

export const proposalWords = {
  title: 'Vorschläge aus dem Katalog',
  none: 'Für die Anlagen in Ihren Bereichen schlägt der Katalog gerade nichts vor.',
  noneNarrowed: 'Hier schlägt der Katalog gerade nichts vor.',
  unread: 'Die Vorschläge kommen vom Server, mit Verbindung.',
  loading: 'Die Vorschläge werden geladen.',
  mayNot: 'Bestätigen und verwerfen kann, wer das Pflichtenverzeichnis führt.',
  choose:
    'Öffnen Sie eine Pflichtart. Was Sie dort auswählen, bestätigen oder verwerfen Sie hier in einem Schritt.',
  dismissalHint:
    'Pflicht beim Verwerfen. Ein verworfener Vorschlag kommt nicht wieder, bis jemand die Verwerfung zurücknimmt.',
  dismissalPlaceholder: 'Warum die Pflicht für diese Anlagen nicht gilt',
  dismissalPlaceholderOne: 'Warum die Pflicht für diese Anlage nicht gilt',
  dismissalKept:
    'Begründung und Tag bleiben am verworfenen Vorschlag festgehalten, wer verworfen hat im Änderungsprotokoll. Auch die Entscheidung, dass eine Pflicht nicht gilt, muss sich später belegen lassen.',
  noReason: 'Die Begründung fehlt.',
  noInterval: 'Die Frist fehlt.',
  noIntervalReason: 'Die Begründung der Frist fehlt; ohne Vorgabe braucht jede Frist eine.',
  noConnection: 'Bestätigt und verworfen wird mit Verbindung. Gerade ist keine da.',
  unguided:
    'Die Pflichtart gibt keine Frist vor. Sie legen sie für alle ausgewählten Anlagen fest und begründen sie.',
} as const

/** The proposals as the route reads them, under the duties, which a decision changes. */
export function proposalsQuery(filter: ProposalFilter) {
  const { package: _, ...asked } = filter

  return {
    queryKey: ['duties', 'proposals', asked],
    queryFn: () => request<DutyProposals>(proposalRequest(asked)),
    // A refusal is an answer: asking again brings the same one.
    retry: (count: number, error: unknown) => !(error instanceof RequestRefused) && count < 2,
  } as const
}

/** The proposals of one asset, under its file: a change of the asset drops them with it (#88). */
export function assetProposalsQuery(assetId: string) {
  return {
    queryKey: ['assets', 'proposals', assetId],
    queryFn: () => request<DutyProposals>(proposalRequest({ assetId })),
  } as const
}

/** What a decision makes the screens read again: the duties, and what was read of the assets. */
export async function afterADecision(queries: ReturnType<typeof useQueryClient>): Promise<void> {
  await queries.invalidateQueries({ queryKey: ['duties'] })
  queries.removeQueries({ queryKey: ['assets'] })
}

// "AN-00015 Betriebsmittel Werkstatt", as the table of the proposals names an asset as well (#236).
export const assetName = proposedAssetName

/** "12 Anlagen", "1 Anlage". */
function assetsWords(count: number): string {
  return count === 1 ? '1 Anlage' : `${count.toLocaleString('de-DE')} Anlagen`
}

/** "12 Vorschläge", "1 Vorschlag". */
export function proposalsWords(count: number): string {
  return count === 1 ? '1 Vorschlag' : `${count.toLocaleString('de-DE')} Vorschläge`
}

/** A group of the list: one duty kind, and the assets it is proposed for. */
interface ProposalGroup {
  readonly kind: string
  readonly entry: CatalogueEntry<DutyKind> | null
  readonly assets: readonly ProposedAsset[]
}

/**
 * The proposals by duty kind, in the order of the catalogue; a kind this
 * device has no catalogue for comes last, by its key.
 */
function groupsOf(
  proposals: readonly DutyProposal[],
  catalogue: Catalogue | null,
  on: IsoDate,
): ProposalGroup[] {
  // The order of the table as well (#236).
  const inOrder = byProposedKind(catalogue, on)
  const byKind = new Map<string, ProposedAsset[]>()

  for (const proposal of proposals) {
    byKind.set(proposal.kind, [...(byKind.get(proposal.kind) ?? []), proposal.asset])
  }

  return [...byKind.entries()]
    .map(([kind, assets]) => ({ kind, entry: catalogue?.dutyKind(kind, on) ?? null, assets }))
    .sort((left, right) => inOrder(left.kind, right.kind))
}

/** "Brandschutz · ASR A2.2 · Höchstfrist 24 Monate · Fachkraft": what a group of a kind is. */
export function kindLine(
  catalogue: Catalogue | null,
  kind: string,
  entry: CatalogueEntry<DutyKind> | null,
  on: IsoDate,
): string {
  if (catalogue === null || entry === null) {
    return kind
  }

  const itsPackage = catalogue.packages.find((each) => each.name === packageOf(kind))

  return [
    itsPackage?.title,
    entry.definition.source,
    intervalLine(catalogue, entry.definition, on),
    qualificationLevelLabel[entry.definition.qualification.level],
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Where an asset stands: "Feuerwache Nord, Wache". */
function placeOf(
  asset: ProposedAsset,
  properties: readonly RecordState[],
  buildings: readonly RecordState[],
): string {
  const property = properties.find((record) => record['id'] === asset.propertyId)
  const building = buildings.find((record) => record['id'] === asset.buildingId)

  return [maybeText(property ?? null, 'name'), maybeText(building ?? null, 'name')]
    .filter(Boolean)
    .join(', ')
}

/** How many rows of an open group stand before "weitere zeigen". */
const firstRows = 5

export function ProposalsScreen() {
  const search = useSearch({ strict: false })
  const filter = useMemo(() => proposalFilterOf(search), [search])
  const navigate = useNavigate()
  const keeps = useRight('duty.write')
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const read = useQuery(proposalsQuery(filter))
  const on = today()
  // Undefined: the first group stands open; null: none does.
  const [open, setOpen] = useState<string | null | undefined>(undefined)
  const [chosen, setChosen] = useState<{ kind: string; ids: ReadonlySet<string> } | null>(null)
  const [showAll, setShowAll] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<{
    asset: ProposedAsset
    group: ProposalGroup
  } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // The open proposals the list shows under what it is narrowed by, as a table (#236).
  const table = useTableExport(proposalTableRequest(filter, 'open'))

  const proposals = (read.data?.proposals ?? []).filter(
    (proposal) => filter.package === undefined || packageOf(proposal.kind) === filter.package,
  )
  const dismissed = (read.data?.dismissed ?? []).filter(
    (each) => filter.package === undefined || packageOf(each.kind) === filter.package,
  )
  const groups = groupsOf(proposals, catalogue, on)
  const openKind = open === undefined ? (groups[0]?.kind ?? null) : open
  const openGroup = groups.find((group) => group.kind === openKind) ?? null
  // What is chosen in the open group: all of it when it opens, and never an
  // asset that has left it since.
  const chosenIds = new Set(
    (openGroup?.assets ?? [])
      .map((asset) => asset.id)
      .filter((id) => chosen?.kind !== openKind || chosen.ids.has(id)),
  )
  const assetCount = new Set(proposals.map((proposal) => proposal.asset.id)).size
  const narrowedAsset = filter.assetId === undefined ? null : (proposals[0]?.asset ?? null)

  const show = (next: ProposalFilter) => {
    void navigate({ to: proposalPlace.to, search: proposalSearch(next), replace: true })
  }
  const choose = (kind: string, ids: ReadonlySet<string>) => {
    setChosen({ kind, ids })
  }

  const packages = (catalogue?.contents(on) ?? []).filter((pack) => pack.dutyKinds.length > 0)
  const sub =
    filter.assetId !== undefined
      ? `Für die Anlage ${narrowedAsset ? assetName(narrowedAsset) : ''}`.trim()
      : filter.dutyKind !== undefined
        ? `Für die Pflichtart ${catalogue?.dutyKind(filter.dutyKind, on)?.definition.label ?? filter.dutyKind}`
        : undefined

  return (
    <Screen>
      <PageHead
        title={proposalWords.title}
        crumbs={[dutyRegisterPlace]}
        phoneBack={dutyRegisterPlace}
        {...(read.data
          ? {
              count: `${proposals.length === 1 ? '1 offener Vorschlag' : `${proposals.length.toLocaleString('de-DE')} offene Vorschläge`} an ${assetsWords(assetCount)}`,
            }
          : {})}
        {...(sub === undefined ? {} : { sub })}
        actions={
          <>
            {table.button}
            {dismissed.length > 0 ? (
              <Link
                to={proposalPlaces.dismissed}
                search={proposalSearch(filter)}
                className="text-[13px] text-ink-muted underline"
              >
                {dismissed.length === 1 ? '1 verworfener' : `${dismissed.length} verworfene`}
              </Link>
            ) : null}
            <LinkButton to={dutyRegisterPlace.to} icon={ClipboardCheck}>
              Zum Pflichtenverzeichnis
            </LinkButton>
          </>
        }
      />
      {table.trouble}
      <div className="flex flex-wrap items-end gap-2.5">
        <RegisterFilter
          label="Liegenschaft"
          className="lg:w-[200px]"
          value={filter.propertyId ?? ''}
          onChange={(value) => {
            const { propertyId: _, assetId: __, ...rest } = filter

            show(value === '' ? rest : { ...rest, propertyId: value })
          }}
        >
          <option value="">Alle Liegenschaften</option>
          {[...properties]
            .sort((left, right) =>
              (maybeText(left, 'name') ?? '').localeCompare(maybeText(right, 'name') ?? '', 'de'),
            )
            .map((property) => (
              <option key={String(property['id'])} value={String(property['id'])}>
                {maybeText(property, 'name')}
              </option>
            ))}
        </RegisterFilter>
        <RegisterFilter
          label="Paket"
          className="lg:w-[160px]"
          value={filter.package ?? ''}
          onChange={(value) => {
            const { package: _, ...rest } = filter

            show(value === '' ? rest : { ...rest, package: value })
          }}
        >
          <option value="">Alle Pakete</option>
          {packages.map((pack) => (
            <option key={pack.name} value={pack.name}>
              {pack.title}
            </option>
          ))}
        </RegisterFilter>
        {filter.assetId !== undefined || filter.dutyKind !== undefined ? (
          <button
            type="button"
            className="h-8 cursor-pointer text-[13px] text-ink-muted underline max-lg:h-10"
            onClick={() => {
              const { assetId: _, dutyKind: __, ...rest } = filter

              show(rest)
            }}
          >
            {filter.assetId !== undefined ? 'Alle Anlagen' : 'Alle Pflichtarten'}
          </button>
        ) : null}
      </div>
      {done ? (
        <p role="status" className="text-[13px] font-medium text-done">
          {done}
        </p>
      ) : null}
      {read.data === undefined ? (
        <Empty>
          {read.isError || read.fetchStatus === 'paused'
            ? proposalWords.unread
            : proposalWords.loading}
        </Empty>
      ) : groups.length === 0 ? (
        <Empty>
          {Object.keys(filter).length > 0 ? proposalWords.noneNarrowed : proposalWords.none}
        </Empty>
      ) : (
        <div
          className={
            keeps
              ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]'
              : 'flex flex-col gap-2.5'
          }
        >
          <div className="flex min-w-0 flex-col gap-2.5">
            {groups.map((group) => (
              <Group
                key={group.kind}
                group={group}
                line={kindLine(catalogue, group.kind, group.entry, on)}
                open={group.kind === openKind}
                keeps={keeps}
                chosen={group.kind === openKind ? chosenIds : new Set()}
                all={showAll === group.kind}
                place={(asset) => placeOf(asset, properties, buildings)}
                onToggle={() => {
                  setOpen(group.kind === openKind ? null : group.kind)
                }}
                onChoose={(ids) => {
                  choose(group.kind, ids)
                }}
                onShowAll={() => {
                  setShowAll(group.kind)
                }}
                onDismiss={(asset) => {
                  setDone(null)
                  setDismissing({ asset, group })
                }}
              />
            ))}
          </div>
          {keeps ? (
            <Batch
              key={openKind ?? ''}
              group={openGroup}
              chosen={openGroup?.assets.filter((asset) => chosenIds.has(asset.id)) ?? []}
              catalogue={catalogue}
              properties={properties}
              onDone={setDone}
            />
          ) : (
            <p className="text-[13px] text-ink-muted">{proposalWords.mayNot}</p>
          )}
        </div>
      )}
      {dismissing ? (
        <DismissProposalDialog
          asset={dismissing.asset}
          kind={dismissing.group.kind}
          label={dismissing.group.entry?.definition.label ?? dismissing.group.kind}
          onClose={() => {
            setDismissing(null)
          }}
          onDismissed={() => {
            setDone('1 Vorschlag verworfen.')
          }}
        />
      ) : null}
    </Screen>
  )
}

/** A checkbox of a row or of the whole group, `box()` of the board. */
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
      className="size-4 shrink-0 cursor-pointer accent-solid max-lg:size-5"
      onChange={(event) => {
        onChange(event.target.checked)
      }}
    />
  )
}

/** One duty kind of the list, `proposal_group()` of the board, closed or open with its assets. */
function Group({
  group,
  line,
  open,
  keeps,
  chosen,
  all,
  place,
  onToggle,
  onChoose,
  onShowAll,
  onDismiss,
}: {
  readonly group: ProposalGroup
  readonly line: string
  readonly open: boolean
  readonly keeps: boolean
  readonly chosen: ReadonlySet<string>
  readonly all: boolean
  readonly place: (asset: ProposedAsset) => string
  readonly onToggle: () => void
  readonly onChoose: (ids: ReadonlySet<string>) => void
  readonly onShowAll: () => void
  readonly onDismiss: (asset: ProposedAsset) => void
}) {
  const label = group.entry?.definition.label ?? group.kind
  const shown = all ? group.assets : group.assets.slice(0, firstRows)
  const more = group.assets.length - shown.length
  const ids = group.assets.map((asset) => asset.id)
  const tick = (asset: ProposedAsset) => (
    <Tick
      label={`${assetName(asset)} auswählen`}
      checked={chosen.has(asset.id)}
      onChange={(checked) => {
        const next = new Set(chosen)

        if (checked) {
          next.add(asset.id)
        } else {
          next.delete(asset.id)
        }

        onChoose(next)
      }}
    />
  )
  const nameOf = (asset: ProposedAsset) => (
    <Link to={officePlaces.asset(asset.id)} className="font-medium">
      {asset.name}
    </Link>
  )
  const subOf = (asset: ProposedAsset) =>
    [asset.number, place(asset), `angelegt am ${date(asset.enteredOn)}`].filter(Boolean).join(' · ')
  const actionsOf = (asset: ProposedAsset) => (
    <span className="flex flex-wrap justify-end gap-[5px]">
      <LinkButton
        to={proposalPlaces.confirm}
        search={confirmSearch(asset.id, group.kind)}
        size="small"
        label={`${label} an ${assetName(asset)} bestätigen`}
      >
        Bestätigen
      </LinkButton>
      <Button
        size="small"
        aria-label={`${label} an ${assetName(asset)} verwerfen`}
        onClick={() => {
          onDismiss(asset)
        }}
      >
        Verwerfen
      </Button>
    </span>
  )
  const headingId = `vorschlag-${group.kind}`

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-[5px] border border-line bg-surface px-3.5 py-3 [--surface-here:var(--color-surface)]"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 grow">
          <div className="flex flex-wrap items-center gap-[9px]">
            <h2 id={headingId} className="m-0 text-[15px] font-semibold">
              {label}
            </h2>
            {group.entry ? <ReviewMarks review={group.entry.review} /> : null}
          </div>
          <div className="mt-[3px] text-[13px] text-ink-muted">{line}</div>
        </div>
        <span className="text-[13px] whitespace-nowrap text-ink-faint max-sm:hidden">
          {assetsWords(group.assets.length)}
        </span>
        <Button
          size="small"
          icon={open ? ChevronUp : ChevronDown}
          aria-expanded={open}
          aria-label={`${open ? 'Schließen' : 'Öffnen'}: ${label}`}
          onClick={onToggle}
        >
          {open ? 'Schließen' : 'Öffnen'}
        </Button>
      </div>
      {open ? (
        <div className="mt-3">
          <TablePanel
            caption={`${label}: vorgeschlagen für ${assetsWords(group.assets.length)}`}
            cards={shown.map((asset) => ({
              key: asset.id,
              title: nameOf(asset),
              sub: subOf(asset),
              ...(keeps ? { right: tick(asset), actions: actionsOf(asset) } : {}),
            }))}
            footer={
              keeps || more > 0 ? (
                <>
                  {keeps ? (
                    <label className="flex items-center gap-2">
                      <Tick
                        label={`Alle ${String(group.assets.length)} auswählen`}
                        checked={chosen.size === group.assets.length}
                        mixed={chosen.size > 0 && chosen.size < group.assets.length}
                        onChange={(checked) => {
                          onChoose(new Set(checked ? ids : []))
                        }}
                      />
                      <span>
                        {chosen.size} von {group.assets.length} ausgewählt
                      </span>
                    </label>
                  ) : null}
                  <div className="grow" />
                  {more > 0 ? (
                    <button
                      type="button"
                      className="cursor-pointer text-copper-text underline"
                      onClick={onShowAll}
                    >
                      {more} weitere zeigen
                    </button>
                  ) : null}
                </>
              ) : undefined
            }
          >
            <thead>
              <tr>
                {keeps ? (
                  <Column className="w-[34px]">
                    <span className="sr-only">Auswahl</span>
                  </Column>
                ) : null}
                <Column>Anlage</Column>
                {keeps ? (
                  <Column className="w-[190px]">
                    <span className="sr-only">Entscheiden</span>
                  </Column>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((asset) => (
                <tr key={asset.id}>
                  {keeps ? <Cell>{tick(asset)}</Cell> : null}
                  <Cell>
                    <div className="leading-[1.32]">
                      {nameOf(asset)}
                      <div className="text-[12px] text-ink-faint">{subOf(asset)}</div>
                    </div>
                  </Cell>
                  {keeps ? <Cell className="text-right">{actionsOf(asset)}</Cell> : null}
                </tr>
              ))}
            </tbody>
          </TablePanel>
        </div>
      ) : null}
    </section>
  )
}

/** The interval a kind names at the places of the assets chosen, in words: the same state for all, or the whole country. */
function itsInterval(
  catalogue: Catalogue | null,
  entry: CatalogueEntry<DutyKind>,
  chosen: readonly ProposedAsset[],
  properties: readonly RecordState[],
  on: IsoDate,
) {
  const states = new Set(
    chosen.map((asset) => {
      const property = properties.find((record) => record['id'] === asset.propertyId)

      return property ? String(property['federalState']) : ''
    }),
  )
  const [state] = states
  const rule =
    catalogue?.interval(
      entry.definition,
      on,
      states.size === 1 && state !== '' ? (state as FederalState) : undefined,
    ) ?? null

  // In the words of the line of its group: "4 Jahre", not "48 Monate".
  return rule === null ? null : ruleValueWords(rule.record.value, rule.record.unit)
}

/**
 * The card "Auswahl" beside the list: what is chosen in the open group,
 * confirmed with one person who answers for it and one who performs it, or
 * dismissed with one reason, each in one batch. A kind with a maximum or a
 * guide gives every duty its interval, which each duty changes afterwards; a
 * kind without a value takes one interval with its reason for all.
 */
function Batch({
  group,
  chosen,
  catalogue,
  properties,
  onDone,
}: {
  readonly group: ProposalGroup | null
  readonly chosen: readonly ProposedAsset[]
  readonly catalogue: Catalogue | null
  readonly properties: readonly RecordState[]
  /** What was done, said above the list, where it stays when the group is gone. */
  readonly onDone: (said: string | null) => void
}) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const colleagues = useQuery(dutyColleaguesQuery)
  const [responsibleUserId, setResponsibleUserId] = useState('')
  const [performer, setPerformer] = useState<DutyPerformer | null>(null)
  const [performerNote, setPerformerNote] = useState('')
  const [interval, setTypedInterval] = useState('')
  const [unit, setUnit] = useState<'months' | 'days'>('months')
  const [intervalReason, setIntervalReason] = useState('')
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const on = today()

  if (group === null || group.entry === null) {
    return (
      <Panel title="Auswahl">
        <p className="text-[13px] leading-[1.45] text-ink-muted max-sm:text-[15px]">
          {proposalWords.choose}
        </p>
      </Panel>
    )
  }

  const { entry } = group
  const label = entry.definition.label
  const intervalKind = entry.definition.interval.kind
  const its = intervalKind === 'none' ? null : itsInterval(catalogue, entry, chosen, properties, on)
  const count = chosen.length
  const blocked = working || !status.online || count === 0

  async function decide(path: string, values: Record<string, unknown>, said: string) {
    setTrouble(null)
    onDone(null)
    setWorking(true)

    try {
      const result = await askAt(client, 'POST', path, group?.kind ?? '', {
        kind: group?.kind,
        assetIds: chosen.map((asset) => asset.id),
        ...values,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      onDone(said)
      setReason('')
      await afterADecision(queries)
    } finally {
      setWorking(false)
    }
  }

  function confirm() {
    const wrong: Record<string, string> = {}
    const typed = interval.trim()
    const value = /^\d+$/.test(typed) ? Number(typed) : typed
    const asInterval = unit === 'months' ? { intervalMonths: value } : { intervalDays: value }

    if (intervalKind === 'none') {
      const problem =
        typed === ''
          ? proposalWords.noInterval
          : dutyIntervalProblem(asInterval, entry.definition.counting, null)

      if (problem !== null) {
        wrong['interval'] = problem
      }

      if (intervalReason.trim() === '') {
        wrong['intervalReason'] = proposalWords.noIntervalReason
      }
    }

    setProblems(wrong)

    if (Object.keys(wrong).length > 0) {
      return
    }

    void decide(
      '/duties/batch',
      {
        ...(intervalKind === 'none'
          ? { ...asInterval, intervalReason: intervalReason.trim() }
          : {}),
        responsibleUserId: responsibleUserId === '' ? null : responsibleUserId,
        performer,
        performerNote:
          performer === 'contractor' && performerNote.trim() !== '' ? performerNote.trim() : null,
      },
      count === 1 ? '1 Pflicht bestätigt.' : `${String(count)} Pflichten bestätigt.`,
    )
  }

  function dismiss() {
    const said = reason.trim()

    if (said === '') {
      setProblems({ reason: proposalWords.noReason })

      return
    }

    setProblems({})
    void decide(
      '/duty-dismissals/batch',
      { reason: said },
      count === 1 ? '1 Vorschlag verworfen.' : `${String(count)} Vorschläge verworfen.`,
    )
  }

  return (
    <Panel title="Auswahl" roomy>
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] text-ink-muted max-sm:text-[15px]">
          {label} an {assetsWords(count)}.
        </p>
        {status.online ? null : (
          <p role="status" className="text-[13px] font-medium text-ink-muted">
            {proposalWords.noConnection}
          </p>
        )}
        <SelectField
          label="Verantwortlich"
          options={responsibleChoices(colleagues.data, null)}
          value={responsibleUserId}
          onChange={setResponsibleUserId}
        />
        <Choice
          label="Ausgeführt von"
          options={dutyPerformers.map((each) => ({
            value: each,
            label: dutyPerformerLabel[each],
          }))}
          value={performer}
          onChange={setPerformer}
        />
        {performer === 'contractor' ? (
          <Field
            label="Angabe zur Fremdfirma"
            value={performerNote}
            maxLength={dutyLimits.performerNote}
            onChange={(event) => {
              setPerformerNote(event.target.value)
            }}
          />
        ) : null}
        {intervalKind === 'none' ? (
          <>
            <p className="text-[12px] leading-[1.45] text-ink-muted">{proposalWords.unguided}</p>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
              <Field
                label="Frist"
                required
                starred
                inputMode="numeric"
                numeric
                value={interval}
                problem={problems['interval']}
                onChange={(event) => {
                  setTypedInterval(event.target.value)
                }}
              />
              <SelectField
                label="Einheit"
                options={[
                  { value: 'months', label: 'Monate' },
                  { value: 'days', label: 'Tage' },
                ]}
                value={unit}
                onChange={(value) => {
                  setUnit(value === 'days' ? 'days' : 'months')
                }}
              />
            </div>
            <TextArea
              label="Begründung der Frist"
              required
              starred
              rows={2}
              value={intervalReason}
              maxLength={dutyLimits.intervalReason}
              problem={problems['intervalReason']}
              onChange={(event) => {
                setIntervalReason(event.target.value)
              }}
            />
          </>
        ) : (
          <p className="text-[12px] leading-[1.45] text-ink-muted">
            {its === null
              ? 'Die Frist ist die der Pflichtart, im Land jeder Liegenschaft.'
              : intervalKind === 'maximum'
                ? `Frist: ${its}, die Höchstfrist der Pflichtart. Eine kürzere legen Sie danach je Pflicht fest.`
                : `Frist: ${its}, der Richtwert der Pflichtart. Eine andere legen Sie danach je Pflicht fest, mit Begründung.`}
          </p>
        )}
        <Button tone="primary" icon={Check} wide disabled={blocked} onClick={confirm}>
          {working ? 'Einen Moment' : `${proposalsWords(count)} bestätigen`}
        </Button>
        <div className="my-0.5 h-px bg-line" />
        <PanelLabel>Verwerfen</PanelLabel>
        <TextArea
          label="Begründung"
          rows={3}
          value={reason}
          placeholder={proposalWords.dismissalPlaceholder}
          hint={proposalWords.dismissalHint}
          maxLength={dutyLimits.dismissalReason}
          problem={problems['reason']}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <Button wide disabled={blocked} onClick={dismiss}>
          {`${proposalsWords(count)} verwerfen`}
        </Button>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * One proposal dismissed with its reason, `vorschlag_verwerfen()` of the
 * boards: from its row in the list and from the form that confirms it. The
 * reason is kept at the dismissal, and who dismissed in the log of changes.
 */
export function DismissProposalDialog({
  asset,
  kind,
  label,
  onClose,
  onDismissed,
}: {
  readonly asset: Pick<ProposedAsset, 'id' | 'number' | 'name'>
  readonly kind: string
  readonly label: string
  readonly onClose: () => void
  readonly onDismissed?: () => void
}) {
  const client = useSync()
  const queries = useQueryClient()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function save() {
    const said = reason.trim()

    setTrouble(null)

    if (said === '') {
      setProblem(proposalWords.noReason)

      return
    }

    setProblem(undefined)
    setWorking(true)

    try {
      const result = await askAt(client, 'POST', '/duty-dismissals', asset.id, {
        assetId: asset.id,
        kind,
        reason: said,
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await afterADecision(queries)
      onClose()
      onDismissed?.()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Vorschlag verwerfen"
      width={520}
      onClose={onClose}
      sub={`${label}, ${assetName(asset)}`}
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextArea
          label="Begründung"
          required
          starred
          rows={3}
          value={reason}
          placeholder={proposalWords.dismissalPlaceholderOne}
          hint={proposalWords.dismissalHint}
          maxLength={dutyLimits.dismissalReason}
          problem={problem}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
        <NoteBox>{proposalWords.dismissalKept}</NoteBox>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" disabled={working}>
            {working ? 'Einen Moment' : 'Verwerfen'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export const dismissedWords = {
  title: 'Verworfene Vorschläge',
  none: 'Kein Vorschlag ist verworfen.',
  backAgain:
    'Zurückgenommen ist der Vorschlag wieder offen und steht unter den Vorschlägen. Bestätigt wird er dort.',
} as const

/**
 * The proposals dismissed, `vorschlaege_verworfen()` of the boards (#102):
 * each with its asset, its duty kind, the reason and the day. Taking one back
 * makes it an open proposal again, at once: it decides nothing yet, so it
 * asks nothing first. Who dismissed stands in the log of changes.
 */
export function DismissedProposalsScreen() {
  const search = useSearch({ strict: false })
  const filter = useMemo(() => proposalFilterOf(search), [search])
  const keeps = useRight('duty.write')
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const read = useQuery(proposalsQuery(filter))
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const on = today()
  // The proposals dismissed, under what the list is narrowed by, as a table (#236).
  const table = useTableExport(proposalTableRequest(filter, 'dismissed'))

  const dismissed = (read.data?.dismissed ?? []).filter(
    (each) => filter.package === undefined || packageOf(each.kind) === filter.package,
  )
  const assetCount = new Set(dismissed.map((each) => each.asset.id)).size

  async function takeBack(id: string) {
    setTrouble(null)
    setWorking(id)

    try {
      const result = await askAt(client, 'DELETE', `/duty-dismissals/${id}`, id)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      await afterADecision(queries)
    } finally {
      setWorking(null)
    }
  }

  const kindOf = (kind: string) => catalogue?.dutyKind(kind, on) ?? null
  const kindCell = (kind: string) => {
    const entry = kindOf(kind)
    const itsPackage = catalogue?.packages.find((each) => each.name === packageOf(kind))

    return (
      <div className="leading-[1.32]">
        <div className="font-medium">{entry?.definition.label ?? kind}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-faint">
          <span>{[itsPackage?.title, entry?.definition.source].filter(Boolean).join(' · ')}</span>
          {entry ? <ReviewMarks review={entry.review} /> : null}
        </div>
      </div>
    )
  }
  const takeBackButton = (id: string, words: string) =>
    keeps ? (
      <Button
        size="small"
        aria-label={`Zurücknehmen: ${words}`}
        disabled={working !== null || !status.online}
        onClick={() => {
          void takeBack(id)
        }}
      >
        Zurücknehmen
      </Button>
    ) : null

  return (
    <Screen>
      <PageHead
        title={dismissedWords.title}
        crumbs={[dutyRegisterPlace, proposalPlace]}
        phoneBack={proposalPlace}
        {...(read.data
          ? {
              count: `${dismissed.length === 1 ? '1 verworfener Vorschlag' : `${dismissed.length.toLocaleString('de-DE')} verworfene Vorschläge`} an ${assetsWords(assetCount)}`,
            }
          : {})}
        actions={
          <>
            {table.button}
            <LinkButton to={proposalPlace.to} search={proposalSearch(filter)} icon={BookOpen}>
              Zu den Vorschlägen
            </LinkButton>
          </>
        }
      />
      {table.trouble}
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      {read.data === undefined ? (
        <Empty>
          {read.isError || read.fetchStatus === 'paused'
            ? proposalWords.unread
            : proposalWords.loading}
        </Empty>
      ) : dismissed.length === 0 ? (
        <Empty>{dismissedWords.none}</Empty>
      ) : (
        <TablePanel
          caption="Verworfene Vorschläge mit Anlage, Pflichtart, Begründung und Tag"
          note={dismissedWords.backAgain}
          cards={dismissed.map((each) => ({
            key: each.id,
            title: (
              <Link to={officePlaces.asset(each.asset.id)} className="font-medium">
                {each.asset.name}
              </Link>
            ),
            sub: [
              kindOf(each.kind)?.definition.label ?? each.kind,
              each.reason,
              `verworfen am ${date(each.dismissedOn)}`,
            ].join(' · '),
            actions: takeBackButton(
              each.id,
              `${assetName(each.asset)}, ${kindOf(each.kind)?.definition.label ?? each.kind}`,
            ),
          }))}
        >
          <thead>
            <tr>
              <Column className="w-[210px]">{dismissedTableColumns.asset}</Column>
              <Column className="w-[250px]">{dismissedTableColumns.kind}</Column>
              <Column>{dismissedTableColumns.reason}</Column>
              <Column className="w-[92px]">Verworfen</Column>
              {keeps ? (
                <Column className="w-[140px]">
                  <span className="sr-only">Zurücknehmen</span>
                </Column>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {dismissed.map((each) => (
              <tr key={each.id}>
                <Cell>
                  <div className="leading-[1.32]">
                    <Link to={officePlaces.asset(each.asset.id)} className="font-medium">
                      {each.asset.name}
                    </Link>
                    <div className="text-[12px] text-ink-faint">
                      {[each.asset.number, placeOf(each.asset, properties, buildings)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </Cell>
                <Cell>{kindCell(each.kind)}</Cell>
                <Cell>{each.reason}</Cell>
                <Cell className="numeric">{date(each.dismissedOn)}</Cell>
                {keeps ? (
                  <Cell className="text-right">
                    {takeBackButton(
                      each.id,
                      `${assetName(each.asset)}, ${kindOf(each.kind)?.definition.label ?? each.kind}`,
                    )}
                  </Cell>
                ) : null}
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

/**
 * "Vorschläge aus dem Katalog" under the duties of an asset (#87, `anlagenakte()`
 * of the boards): how many are open, leading to them, and how many are
 * dismissed, leading to those. Nothing while it is read or cannot be.
 */
export function ProposalsNote({ assetId }: { readonly assetId: string }) {
  const read = useQuery(assetProposalsQuery(assetId))

  if (read.data === undefined) {
    return null
  }

  const open = read.data.proposals.length
  const gone = read.data.dismissed.length
  const search = proposalSearch({ assetId })

  return (
    <span>
      Vorschläge aus dem Katalog:{' '}
      {open === 0 ? (
        'keine offenen.'
      ) : (
        <>
          <Link to={proposalPlace.to} search={search} className={factLink}>
            {open === 1 ? '1 offener' : `${String(open)} offene`}
          </Link>
          .
        </>
      )}
      {gone === 0 ? null : (
        <>
          {' '}
          <Link to={proposalPlaces.dismissed} search={search} className={factLink}>
            {gone === 1 ? '1 verworfener Vorschlag' : `${String(gone)} verworfene Vorschläge`}
          </Link>
        </>
      )}
    </span>
  )
}

/**
 * "23 Vorschläge" in the head of the register (`pflichten()` of the boards),
 * for whoever keeps it: the way to the proposals, of the property the
 * register is narrowed to where it is.
 */
export function ProposalsButton({ propertyId }: { readonly propertyId?: string }) {
  const keeps = useRight('duty.write')
  const filter = propertyId === undefined ? {} : { propertyId }
  const read = useQuery({ ...proposalsQuery(filter), enabled: keeps })
  const count = read.data?.proposals.length

  return keeps ? (
    <LinkButton to={proposalPlace.to} search={proposalSearch(filter)} icon={BookOpen}>
      {count === undefined ? 'Vorschläge' : proposalsWords(count)}
    </LinkButton>
  ) : null
}
