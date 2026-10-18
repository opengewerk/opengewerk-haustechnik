import {
  assetConditionLabel,
  assetConditions,
  type AssetEntry,
  assetTableColumns,
  type AssetRegister,
  type AssetRegisterFilter,
  type Catalogue,
  costGroupAbove,
  costGroupWords,
  documentFilterLabel,
  documentFilters,
  isGeneralKind,
  type LifecycleState,
  lifecycleStateLabel,
  lifecycleStates,
  lackingWords,
  placeWords,
  type RecordState,
  showsShutDown,
  shutDownLabel,
  withoutLifecycle,
} from '@opengewerk/haustechnik-domain'
import {
  Button,
  cardLink,
  Cell,
  Column,
  Panel,
  SelectField,
  TablePanel,
  useBand,
} from '@opengewerk/platform-web'
import { today } from '@opengewerk/platform-web/format'
import { Empty, PageHead, Screen, useTableExport } from '@opengewerk/platform-web/office'
import { useRight } from '@opengewerk/platform-web/session'
import {
  maybeText,
  refusalFor,
  request,
  text,
  useRecords,
  useSync,
  useSyncStatus,
} from '@opengewerk/platform-web/sync'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Check, Pencil, Plus, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'

import { kindChoices } from '../../app/asset-values.js'
import { useCatalogue } from '../../sync/catalogue.js'
import { askAt } from '../../sync/made-at.js'
import {
  assetForms,
  assetRegisterPlace,
  newAssetSearch,
  registerFilterOf,
  registerRequest,
  registerSearch,
  registerTableRequest,
} from '../asset-addresses.js'
import { importPlaces } from '../import-addresses.js'
import { PrintLabelsButton } from '../labels.js'
import { AssetConditionMark } from '../../app/asset-marks.js'
import { AssetState } from '../asset-state.js'
import { officePlaces } from '../place-addresses.js'
import { countedAssets } from '../place-pages.js'
import { assetKindChoices, PlaceFilter, RegisterFilter as Filter } from '../register-filter.js'

/**
 * "Anlagen" in the office, `anlagen()` of the boards (4.2 of the concept): the
 * register over every building, narrowed by place, cost group, kind, condition
 * and life cycle.
 *
 * The list comes from the server a page at a time and is narrowed there, so
 * that a few thousand assets never lie in the browser at once. The condition
 * of an asset is worked out there as well, from its duties, their evidence
 * and its defects on the day it is read; the evidence never travels to a
 * device. So this screen needs a connection, and says so without one.
 *
 * What it is narrowed by stands in the address (`asset-addresses.ts`). The
 * names of the places and of the kinds are read from the device, which holds
 * every place of the areas of the person and the catalogue of its server.
 */
/** "Die 12 gelisteten Anlagen", what a print of labels for the list is called. */
export function listedWords(total: number): string {
  return total === 1 ? 'Die eine gelistete Anlage' : `Die ${String(total)} gelisteten Anlagen`
}

export function AssetRegisterScreen() {
  const search = useSearch({ strict: false })
  const filter = useMemo(() => registerFilterOf(search), [search])
  const navigate = useNavigate()
  const records = useRight('asset.record')
  const imports = useRight('asset.write')
  const catalogue = useCatalogue()
  const properties = useRecords('properties')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')
  // What the register shows under its filter, whole and not a page, as a table (#138).
  const table = useTableExport(registerTableRequest(filter))
  const band = useBand()
  // "Anlagenart berichtigen" (#351): a box in front of every row, from the width of a tablet on.
  const [correcting, setCorrecting] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [done, setDone] = useState<string | null>(null)
  const corrects = correcting && band !== 'S'

  const pages = useInfiniteQuery({
    queryKey: ['assets', 'register', filter],
    queryFn: ({ pageParam }) => request<AssetRegister>(registerRequest(filter, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const shown = all.reduce((sum, page) => sum + page.assets.length, 0)

      return shown < last.total ? shown : undefined
    },
  })

  const narrowed = Object.keys(filter).length > 0
  const first = pages.data?.pages[0]
  const assets = pages.data?.pages.flatMap((page) => page.assets) ?? []

  const show = (next: AssetRegisterFilter) => {
    void navigate({ to: assetRegisterPlace.to, search: registerSearch(next), replace: true })
  }
  /** The filter with one part set, or without it for the choice "all". */
  const set = (name: keyof AssetRegisterFilter, value: string) => {
    const { [name]: _, ...rest } = filter

    show(value === '' ? rest : { ...rest, [name]: value })
  }

  const nameOf = (records: readonly RecordState[], id: string | null) =>
    id === null ? null : maybeText(records.find((record) => record['id'] === id) ?? null, 'name')
  /** "Schulzentrum Am Lindenhain, Schulhaus, E.14": property, building and the room by its number. */
  const placeOf = (asset: AssetEntry): string => {
    const room = rooms.find((record) => record['id'] === asset.roomId)

    return placeWords([
      nameOf(properties, asset.propertyId),
      nameOf(buildings, asset.buildingId),
      room ? (maybeText(room, 'number') ?? maybeText(room, 'name')) : null,
    ])
  }
  const kindOf = (asset: AssetEntry) => kindLabel(catalogue, asset.kind)
  const chosenAssets = assets.filter((asset) => chosen.has(asset.id))
  const choose = (ids: ReadonlySet<string>) => {
    setChosen(ids)
    setDone(null)
  }
  const stopCorrecting = () => {
    setCorrecting(false)
    setChosen(new Set())
  }

  return (
    <Screen>
      <PageHead
        title="Anlagen"
        {...(first ? { count: countedIn(first) } : {})}
        {...(records
          ? {
              actions: (
                <>
                  {table.button}
                  {/* A list taken over whole, for whoever keeps the assets (#100). */}
                  {imports ? (
                    <Button
                      icon={Upload}
                      onClick={() => {
                        void navigate({ to: importPlaces.assets })
                      }}
                    >
                      Importieren
                    </Button>
                  ) : null}
                  {/* A label for everything the list shows, under the filter
                      it is narrowed by, or a sheet that hangs on nothing yet. */}
                  <PrintLabelsButton
                    offers={
                      first && first.total > 0
                        ? [
                            {
                              key: 'assets',
                              label: listedWords(first.total),
                              batch: { what: 'assets', filter },
                              count: first.total,
                            },
                          ]
                        : []
                    }
                    properties={properties.map((property) => ({
                      id: String(property['id']),
                      name: text(property, 'name'),
                      areaId: property['areaId'],
                    }))}
                    propertyId={
                      filter.propertyId ??
                      maybeText(
                        buildings.find((building) => building['id'] === filter.buildingId) ?? null,
                        'propertyId',
                      ) ??
                      undefined
                    }
                  />
                  {band === 'S' ? null : (
                    <Button
                      icon={Pencil}
                      aria-pressed={correcting}
                      onClick={() => {
                        if (correcting) {
                          stopCorrecting()
                        } else {
                          setCorrecting(true)
                          setDone(null)
                        }
                      }}
                    >
                      {kindCorrectionWords.open}
                    </Button>
                  )}
                  <Button
                    tone="primary"
                    icon={Plus}
                    onClick={() => {
                      // In the building the list is narrowed to, where it is.
                      void navigate({
                        to: assetForms.new,
                        search: newAssetSearch(filter.buildingId),
                      })
                    }}
                  >
                    Neue Anlage
                  </Button>
                </>
              ),
            }
          : { actions: table.button })}
      />
      {table.trouble}
      <Filters
        filter={filter}
        catalogue={catalogue}
        properties={properties}
        buildings={buildings}
        onSet={set}
        onPlace={(place) => {
          const { propertyId: _, buildingId: __, ...rest } = filter

          show({ ...rest, ...place })
        }}
        {...(narrowed
          ? {
              onReset: () => {
                show({})
              },
            }
          : {})}
      />
      {done ? (
        <p role="status" className="text-[13px] font-medium text-done">
          {done}
        </p>
      ) : null}
      {corrects && first !== undefined && first.total > 0 ? (
        <KindCorrection
          chosen={chosenAssets}
          loaded={assets.length}
          catalogue={catalogue}
          onDone={(said) => {
            stopCorrecting()
            setDone(said)
          }}
          onCancel={stopCorrecting}
        />
      ) : null}
      {first === undefined ? (
        <Panel>
          <Empty>
            {pages.isError
              ? 'Das Anlagenverzeichnis ließ sich nicht laden. Es kommt vom Server, mit Verbindung.'
              : pages.fetchStatus === 'paused'
                ? 'Das Anlagenverzeichnis kommt vom Server. Gerade ist keine Verbindung da.'
                : 'Das Anlagenverzeichnis wird geladen.'}
          </Empty>
        </Panel>
      ) : first.total === 0 ? (
        <Panel>
          <Empty>
            {narrowed
              ? 'Keine Anlage passt zu dem, wonach das Verzeichnis eingegrenzt ist.'
              : 'Noch ist keine Anlage aufgenommen.'}
          </Empty>
        </Panel>
      ) : (
        <TablePanel
          caption="Anlagen mit Anlagenart, Standort, Zustand und Lebenszyklus"
          cards={assets.map((asset) => ({
            key: asset.id,
            title: (
              <Link to={officePlaces.asset(asset.id)} className={cardLink}>
                {asset.name}
              </Link>
            ),
            sub: [
              asset.number,
              kindOf(asset),
              placeOf(asset),
              showsShutDown(asset.lifecycleState, asset.shutDown)
                ? shutDownLabel
                : asset.lifecycleState === null || asset.lifecycleState === 'in_service'
                  ? null
                  : lifecycleStateLabel[asset.lifecycleState],
              asset.lacking.length === 0 ? null : `Es fehlt: ${lackingWords(asset.lacking)}`,
            ]
              .filter((part) => part !== null && part !== '')
              .join(' · '),
            right: <AssetConditionMark standing={asset} />,
          }))}
          footer={
            <>
              {corrects ? (
                <>
                  <Tick
                    label={kindCorrectionWords.all(assets.length)}
                    checked={chosenAssets.length === assets.length}
                    mixed={chosenAssets.length > 0 && chosenAssets.length < assets.length}
                    onChange={(checked) => {
                      choose(new Set(checked ? assets.map((asset) => asset.id) : []))
                    }}
                  />
                  <span>{kindCorrectionWords.chosen(chosenAssets.length, assets.length)}</span>
                  <span className="grow" />
                </>
              ) : null}
              <span>
                {assets.length.toLocaleString('de-DE')} von {first.total.toLocaleString('de-DE')}
              </span>
              {/* While boxes stand, the count goes right, beside what is chosen at the left. */}
              {corrects ? null : <span className="grow" />}
              {pages.hasNextPage ? (
                <Button
                  size="small"
                  disabled={pages.isFetchingNextPage}
                  onClick={() => {
                    void pages.fetchNextPage()
                  }}
                >
                  Weitere laden
                </Button>
              ) : null}
            </>
          }
        >
          <thead>
            <tr>
              {corrects ? (
                <Column className="w-[44px] min-w-[44px]">
                  <span className="sr-only">{kindCorrectionWords.column}</span>
                </Column>
              ) : null}
              {/* The headings of the table "Als Tabelle" writes as well. */}
              {assetTableColumns.map((heading, index) => (
                <Column key={heading} className={columnWidths[index]}>
                  {heading}
                </Column>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                {corrects ? (
                  <Cell>
                    <Tick
                      label={`${asset.number} ${asset.name} auswählen`}
                      checked={chosen.has(asset.id)}
                      onChange={(checked) => {
                        const next = new Set(chosen)

                        if (checked) {
                          next.add(asset.id)
                        } else {
                          next.delete(asset.id)
                        }

                        choose(next)
                      }}
                    />
                  </Cell>
                ) : null}
                <Cell>
                  <span className="numeric text-ink-faint">{asset.number}</span>
                </Cell>
                <Cell className="font-medium">
                  <Link to={officePlaces.asset(asset.id)}>{asset.name}</Link>
                  <LackingLine lacking={asset.lacking} />
                </Cell>
                <Cell>{kindOf(asset)}</Cell>
                <Cell className="text-ink-muted">{placeOf(asset)}</Cell>
                <Cell>
                  <AssetConditionMark standing={asset} />
                </Cell>
                <Cell>
                  <AssetState state={asset.lifecycleState ?? undefined} shutDown={asset.shutDown} />
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
    </Screen>
  )
}

/** The widths of the columns, in the order of `assetTableColumns`. */
const columnWidths = [
  'w-[96px] min-w-[84px]',
  'min-w-[180px]',
  'w-[210px] min-w-[150px]',
  'w-[230px] min-w-[170px]',
  'w-[190px] min-w-[150px]',
  // Wide enough for "Außer Betrieb durch Mangel" (#345).
  'w-[220px] min-w-[120px]',
] as const

/** What an asset kind is called, or its key where this device has no catalogue that knows it. */
export function kindLabel(catalogue: Catalogue | null, key: string): string {
  return catalogue?.assetKind(key, today())?.definition.label ?? key
}

/**
 * "KG 420" for the general kind of a cost group, and nothing for a kind of a
 * package. A general kind is called like the group it stands for, and the
 * number tells it from the kinds of a package, as the import of assets names
 * it (4.2 of the concept).
 */
export function generalKindGroup(catalogue: Catalogue | null, key: string): string | null {
  const costGroup = isGeneralKind(key)
    ? catalogue?.assetKind(key, today())?.definition.costGroup
    : undefined

  return costGroup === undefined ? null : `KG ${costGroup}`
}

/** What "Anlagenart berichtigen" says (#351), `anlagen_art_berichtigen()` of the boards. */
export const kindCorrectionWords = {
  open: 'Anlagenart berichtigen',
  column: 'Auswahl',
  all: (loaded: number) =>
    loaded === 1
      ? 'Die geladene Anlage auswählen'
      : `Alle ${loaded.toLocaleString('de-DE')} geladenen auswählen`,
  chosen: (count: number, loaded: number) =>
    `${count.toLocaleString('de-DE')} von ${loaded.toLocaleString('de-DE')} ausgewählt`,
  kind: 'Neue Anlagenart',
  now: (labels: readonly string[]) =>
    labels.length === 1
      ? `Heute ${labels[0] ?? ''}.`
      : `Heute ${String(labels.length)} Anlagenarten.`,
  after:
    'Ihre Pflichten schlägt der Katalog danach unter „Vorschläge“ vor; Angaben der neuen Art tragen Sie in der Akte nach.',
  noKind: 'Die neue Anlagenart fehlt.',
  correct: (count: number) =>
    count === 1 ? '1 Anlage berichtigen' : `${count.toLocaleString('de-DE')} Anlagen berichtigen`,
  done: (count: number) =>
    count === 1 ? '1 Anlage berichtigt.' : `${count.toLocaleString('de-DE')} Anlagen berichtigt.`,
} as const

/**
 * What the chosen assets become, above the table (#351, 4.2 of the concept:
 * "Kommt das Paket, berichtigt das Anlagenverzeichnis die Anlagenart vieler
 * Anlagen in einem Schritt"). The new kind is one of the catalogue that is no
 * measuring point: a meter needs its number and unit, which a correction of
 * many does not give. Whether each asset fits the kind the server asks, for
 * all of them or none, and its refusal names the asset that does not.
 */
function KindCorrection({
  chosen,
  loaded,
  catalogue,
  onDone,
  onCancel,
}: {
  readonly chosen: readonly AssetEntry[]
  readonly loaded: number
  readonly catalogue: Catalogue | null
  readonly onDone: (said: string) => void
  readonly onCancel: () => void
}) {
  const client = useSync()
  const status = useSyncStatus()
  const queries = useQueryClient()
  const [kind, setKind] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const count = chosen.length
  const kinds = catalogue
    ? kindChoices(catalogue).filter(
        (choice) => catalogue.assetKind(choice.value, today())?.definition.meter === null,
      )
    : []
  const now = [
    ...new Set(
      chosen.map((asset) => {
        const group = generalKindGroup(catalogue, asset.kind)

        return group === null
          ? kindLabel(catalogue, asset.kind)
          : `${kindLabel(catalogue, asset.kind)} (${group})`
      }),
    ),
  ]

  async function correct() {
    if (kind === '') {
      setProblem(kindCorrectionWords.noKind)

      return
    }

    setProblem(null)
    setTrouble(null)
    setWorking(true)

    try {
      const result = await askAt(client, 'PUT', '/assets/kind', kind, {
        kind,
        assetIds: chosen.map((asset) => asset.id),
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))

        return
      }

      // The register reads the kinds anew, and the proposals of the new kinds with it.
      await queries.invalidateQueries({ queryKey: ['assets'] })
      await queries.invalidateQueries({ queryKey: ['duties'] })
      onDone(kindCorrectionWords.done(count))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <p className="text-[14px] font-semibold text-ink">
            {kindCorrectionWords.chosen(count, loaded)}
          </p>
          <p className="text-[12px] leading-[1.45] text-ink-muted">
            {count === 0 ? '' : `${kindCorrectionWords.now(now)} `}
            {kindCorrectionWords.after}
          </p>
        </div>
        <div className="w-[330px] max-w-full">
          <SelectField
            label={kindCorrectionWords.kind}
            options={kinds}
            value={kind}
            onChange={(value) => {
              setKind(value)
              setProblem(null)
            }}
            {...(problem === null ? {} : { problem })}
          />
        </div>
        <Button
          tone="primary"
          icon={Check}
          disabled={working || !status.online || count === 0}
          onClick={() => {
            void correct()
          }}
        >
          {kindCorrectionWords.correct(count)}
        </Button>
        <Button onClick={onCancel}>Abbrechen</Button>
      </div>
      {trouble ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </Panel>
  )
}

/** A box in front of a row of the register or for all of the page, `box()` of the board. */
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

/** "412 Anlagen in 11 Liegenschaften". */
function countedIn(register: AssetRegister): string {
  if (register.total === 0) {
    return 'Keine Anlage'
  }

  return `${countedAssets(register.total)} in ${register.properties.toLocaleString('de-DE')} ${
    register.properties === 1 ? 'Liegenschaft' : 'Liegenschaften'
  }`
}

/** The states of the life cycle the register narrows by, and the one for an asset without an entry. */
const lifecycleChoices: readonly (LifecycleState | typeof withoutLifecycle)[] = [
  ...lifecycleStates,
  withoutLifecycle,
]

export const withoutLifecycleWords = 'Ohne Angabe'

/**
 * The filters over the list, `select_filter()` of the boards: each with its
 * name above it, so that five of them side by side say what they narrow.
 */
function Filters({
  filter,
  catalogue,
  properties,
  buildings,
  onSet,
  onPlace,
  onReset,
}: {
  readonly filter: AssetRegisterFilter
  readonly catalogue: Catalogue | null
  readonly properties: readonly RecordState[]
  readonly buildings: readonly RecordState[]
  readonly onSet: (name: keyof AssetRegisterFilter, value: string) => void
  readonly onPlace: (place: Pick<AssetRegisterFilter, 'propertyId' | 'buildingId'>) => void
  readonly onReset?: () => void
}) {
  const kinds = useMemo(() => assetKindChoices(catalogue), [catalogue])
  // A building is read by the groups of the second level, 460 with the
  // elevators of 461. A group or a kind the address names beyond those the
  // catalogue of this device knows stays a choice, so that the filter shows
  // what the list is narrowed by.
  const costGroups = useMemo(
    () =>
      [
        ...new Set([
          ...kinds.map((kind) => costGroupAbove(kind.costGroup)),
          ...(filter.costGroup === undefined ? [] : [filter.costGroup]),
        ]),
      ].sort(),
    [kinds, filter.costGroup],
  )
  // A group goes by its number, and behind it by what the catalogue calls an
  // asset of that group no package describes more closely (#163).
  const named = useMemo(() => catalogue?.assetKinds(today()) ?? [], [catalogue])
  const unknownKind =
    filter.kind !== undefined && !kinds.some((kind) => kind.key === filter.kind)
      ? filter.kind
      : null

  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <PlaceFilter
        className="lg:w-[220px]"
        place={filter}
        properties={properties}
        buildings={buildings}
        onPlace={onPlace}
      />
      <Filter
        label="Kostengruppe"
        className="lg:w-[210px]"
        value={filter.costGroup ?? ''}
        onChange={(value) => {
          onSet('costGroup', value)
        }}
      >
        <option value="">Alle</option>
        {costGroups.map((group) => (
          <option key={group} value={group}>
            {costGroupWords(group, named)}
          </option>
        ))}
      </Filter>
      <Filter
        label="Anlagenart"
        className="lg:w-[190px]"
        value={filter.kind ?? ''}
        onChange={(value) => {
          onSet('kind', value)
        }}
      >
        <option value="">Alle</option>
        {kinds.map((kind) => (
          <option key={kind.key} value={kind.key}>
            {kind.label}
          </option>
        ))}
        {unknownKind === null ? null : <option value={unknownKind}>{unknownKind}</option>}
      </Filter>
      <Filter
        label="Zustand"
        className="lg:w-[160px]"
        value={filter.condition ?? ''}
        onChange={(value) => {
          onSet('condition', value)
        }}
      >
        <option value="">Alle Zustände</option>
        {assetConditions.map((condition) => (
          <option key={condition} value={condition}>
            {assetConditionLabel[condition]}
          </option>
        ))}
      </Filter>
      <Filter
        label="Lebenszyklus"
        className="lg:w-[150px]"
        value={filter.lifecycle ?? ''}
        onChange={(value) => {
          onSet('lifecycle', value)
        }}
      >
        <option value="">Alle</option>
        {lifecycleChoices.map((state) => (
          <option key={state} value={state}>
            {state === withoutLifecycle ? withoutLifecycleWords : lifecycleStateLabel[state]}
          </option>
        ))}
      </Filter>
      <Filter
        label="Unterlagen"
        className="lg:w-[170px]"
        value={filter.documents ?? ''}
        onChange={(value) => {
          onSet('documents', value)
        }}
      >
        <option value="">Alle</option>
        {documentFilters.map((documents) => (
          <option key={documents} value={documents}>
            {documentFilterLabel[documents]}
          </option>
        ))}
      </Filter>
      <span className="grow max-lg:hidden" />
      {onReset ? (
        <Button size="small" onClick={onReset}>
          Filter zurücksetzen
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Under the name of an asset: what it lacks of the documents its kind expects
 * (#347), a required one in the tone of a conflict and with "(verlangt)".
 */
function LackingLine({ lacking }: { readonly lacking: AssetEntry['lacking'] }) {
  if (lacking.length === 0) {
    return null
  }

  return (
    <div className="mt-0.5 text-[12px] leading-[1.35] font-normal text-ink-muted">
      Es fehlt:{' '}
      {lacking.map((expected, index) => (
        <span key={expected.key}>
          {index > 0 ? ', ' : null}
          {expected.demand === 'required' ? (
            <span className="font-medium text-conflict">{lackingWords([expected])}</span>
          ) : (
            expected.label
          )}
        </span>
      ))}
    </div>
  )
}
